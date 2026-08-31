# API REST

Base: `/api`. Salvo salud, bootstrap inicial y consumo de pairing, todas las rutas requieren:

```http
Authorization: Bearer <device-token>
```

Las respuestas de error tienen formato estable y no exponen excepciones internas:

```json
{
  "error": {
    "code": "INVALID_QUANTITY",
    "message": "Descripción segura"
  }
}
```

## Rutas públicas

| Método | Ruta                    | Resultado                                                     |
| ------ | ----------------------- | ------------------------------------------------------------- |
| `GET`  | `/api/health`           | Salud del Worker.                                             |
| `POST` | `/api/bootstrap`        | Crea el único hogar, primer device y ciclo activo.            |
| `POST` | `/api/pairings/consume` | Consume una vez un código no caducado y entrega device token. |

Bootstrap recibe `accessKey`, `householdName` opcional y `deviceName` opcional. Si el hogar ya está
inicializado devuelve `409`, incluso aunque la clave sea correcta.

`/api/bootstrap/household` se conserva como alias compatible, pero el cliente utiliza
`/api/bootstrap`. Ningún código de vinculación se envía a ninguno de esos endpoints.

## Rutas privadas

| Método   | Ruta                                   | Resultado                                                   |
| -------- | -------------------------------------- | ----------------------------------------------------------- |
| `POST`   | `/api/pairings`                        | Código de ocho caracteres, URL y expiración a diez minutos. |
| `GET`    | `/api/shopping-cycle/active`           | Ciclo activo con items en orden estable.                    |
| `POST`   | `/api/items`                           | Añade un producto.                                          |
| `PATCH`  | `/api/items/:id`                       | Edita nombre, cantidad, unidad, supermercado o categoría.   |
| `DELETE` | `/api/items/:id`                       | Elimina un producto; devuelve `204`.                        |
| `POST`   | `/api/items/:id/toggle`                | Marca/desmarca sin alterar `sortOrder`.                     |
| `POST`   | `/api/shopping-cycle/complete`         | Completa sólo si hay productos y todos están marcados.      |
| `POST`   | `/api/shopping-cycle/clear`            | Ejecuta `CANCEL`, `CLEAR_ALL` o `CARRY_PENDING`.            |
| `GET`    | `/api/supermarkets`                    | Supermercados activos ordenados.                            |
| `GET`    | `/api/offers`                          | Ofertas publicadas, aisladas por proveedor.                 |
| `GET`    | `/api/offers/for-list`                 | Candidatos Lidl para los pendientes del hogar autenticado.  |
| `GET`    | `/api/settings/loyalty-programs`       | Preferencias loyalty compartidas del hogar.                 |
| `PUT`    | `/api/settings/loyalty-programs/:code` | Actualiza una preferencia loyalty del hogar.                |
| `PUT`    | `/api/items/:id/product-match`         | Confirma el producto Lidl preferido para ese nombre.        |
| `DELETE` | `/api/items/:id/product-match`         | Quita la relación automática aprendida; devuelve `204`.     |
| `PUT`    | `/api/items/:id/product-alternative`   | Acepta o descarta una alternativa Lidl para ese nombre.     |
| `GET`    | `/api/product-preferences/suggestions` | Preferencias por frecuencia y prefijo normalizado.          |

`GET /api/offers?supermarket=lidl|mercadona|carrefour|dia` acepta un filtro opcional. Una caída
parcial no hace fallar los demás proveedores y devuelve `partial: true`. Cada oferta incluye precio
en céntimos, vigencia, fuente, requisito de fidelización, coincidencias con la lista y `fixture`.
En producción Lidl procede exclusivamente de D1 real; los fixtures quedan aislados en modo demo.
`catalogAvailability: PUBLISHED` no representa stock real.

## Matching Lidl de la lista

`GET /api/offers/for-list` obtiene el household exclusivamente del device token. No acepta IDs de
hogar enviados por el cliente y sólo evalúa los items pendientes del ciclo activo. El matching lee
el último catálogo Lidl válido de D1; nunca hace fetch remoto a Lidl ni bloquea la creación de un
producto de la lista.

La respuesta separa `matchedItems` y `unmatchedItems`. Cada match contiene el item familiar sin
modificar, hasta cinco candidatos ordenados, la confianza `HIGH` o `MEDIUM`, las razones del score,
el precio vigente y todas las ofertas activas del candidato, incluida la oferta general y Lidl Plus
cuando ambas existen. Un match heurístico sólo se elige automáticamente con confianza `HIGH` y una
ventaja suficiente sobre el segundo candidato. Los resultados ambiguos permanecen como sugerencias.

Cada candidato incluye además un cálculo `package` independiente del score de identidad:

```json
{
  "descriptor": {
    "description": "750 g",
    "type": "MEASURED",
    "packCount": 1,
    "amountPerPack": 750,
    "unit": "G",
    "totalAmount": 750,
    "approximate": false
  },
  "fit": "OVERBUY",
  "packsNeeded": 2,
  "requestedAmount": 1000,
  "purchasedAmount": 1500,
  "excessAmount": 500,
  "unit": "G",
  "costs": {
    "regularCostCents": 598,
    "generalOfferCostCents": 470,
    "lidlPlusCostCents": 378
  }
}
```

`fit` puede ser `EXACT`, `GOOD`, `OVERBUY`, `UNKNOWN` o `INCOMPATIBLE`. Los importes son escenarios
separados y siempre enteros en céntimos. `UNKNOWN` conserva el match de identidad y el texto del
formato, pero no inventa número de envases ni coste. Las promociones futuras/caducadas no se usan en
el cálculo de la sección actual.

Cada candidato añade `pricing`, calculado por el Worker, con `effectiveCostCents`,
`effectivePriceReason`, `potentialLoyaltyCostCents` y los ahorros general, adicional loyalty y
total. Los componentes Angular no vuelven a calcular qué precio es aplicable.

`PUT /api/items/:id/product-match` recibe:

```json
{ "externalProductId": "lidl-product-id" }
```

La ruta valida que el item pertenece al hogar autenticado, que no prefiere otra cadena y que el
producto sigue publicado en el catálogo Lidl actual. Guarda la selección por household y nombre
normalizado, no por ID del item, para que sobreviva a nuevas listas, habituales y
`CARRY_PENDING`. `DELETE` conserva una preferencia explícita de no seleccionar automáticamente,
pero permite seguir mostrando candidatos manuales si existen.

Los items con supermercado `LIDL`, `ANY` o sin supermercado pueden considerar Lidl. Una
preferencia explícita por Mercadona, Carrefour o DIA no se cambia ni se utiliza para sugerir Lidl
en esta primera versión.

### Alternativas de oferta

Cada elemento de `matchedItems` incluye dos colecciones distintas: `candidates` contiene identidad
`MATCH` y `alternatives` contiene como máximo tres sustituciones con oferta activa. Una alternativa
añade `relationship: "ALTERNATIVE"`, `sourceConcept`, `targetConcept`, `alternativeStrength`,
`alternativeReasons` y `learned`. Match y alternativa pueden coexistir; si no existe oferta de
identidad, el item se devuelve igualmente cuando existe una sustitución útil.

Los contratos `ProductConcept` incluyen conceptos distintos para `PLATANO`, `BANANA`, `MANDARINA`
y `CLEMENTINA`. Por tanto `Plátano → Plátano de Canarias` permanece en `candidates`, mientras
`Plátano → Banana` sólo puede aparecer en `alternatives`; compartir `FRUIT` nunca basta por sí solo.

`PUT /api/items/:id/product-alternative` recibe:

```json
{
  "externalProductId": "producto-lidl",
  "status": "ACCEPTED"
}
```

`status` admite `ACCEPTED` o `DISMISSED`. El Worker obtiene el hogar del device token y deriva y
valida ambos conceptos contra el diccionario explícito. Responde `{ "saved": true }`; no renombra,
reemplaza ni marca el shopping item y no escribe un alias de identidad `CONFIRMED`.

## Programas de fidelización

`GET /api/settings/loyalty-programs` devuelve actualmente `LIDL_PLUS`. La ausencia de una fila se
representa como `UNKNOWN`; nunca se deduce que el hogar tiene el programa por existir una oferta.

```json
{
  "loyaltyPrograms": [{ "program": "LIDL_PLUS", "status": "UNKNOWN" }]
}
```

`PUT /api/settings/loyalty-programs/LIDL_PLUS` acepta `UNKNOWN`, `ENABLED` o `DISABLED`, con
validación runtime. El household se obtiene exclusivamente del device token; un `householdId`
enviado en el cuerpo se ignora. No se almacenan cuentas, tarjetas, QR ni credenciales de Lidl.

## Producto

Creación completa:

```json
{
  "name": "Leche",
  "quantity": "1.5",
  "unit": "litro",
  "supermarketId": "lidl",
  "category": "DAIRY"
}
```

Sólo `name` es obligatorio; los defaults son cantidad `"1"`, unidad `"unidad"` y supermercado
`null`. `category` es opcional al crear: primero se usa la preferencia aprendida, después el
clasificador local y finalmente `OTHER`. Un `PATCH` conserva cualquier campo omitido.

Los códigos admitidos son `DAIRY`, `BAKERY`, `FRUIT`, `VEGETABLES`, `MEAT`, `FISH`, `EGGS`,
`DRINKS`, `WATER`, `COFFEE_TEA`, `PASTA_RICE`, `PANTRY`, `CANNED`, `FROZEN`, `SWEETS`, `CLEANING`,
`HYGIENE`, `PAPER`, `PETS` y `OTHER`. Una categoría desconocida devuelve `INVALID_CATEGORY`.

Unidades: `unidad`, `pack`, `kg`, `g`, `litro`, `ml`, `caja`, `botella`, `otro`.

## Vaciar

```json
{ "action": "CARRY_PENDING" }
```

- `CANCEL`: no modifica nada.
- `CLEAR_ALL`: cierra como `CLEARED` y crea una lista vacía.
- `CARRY_PENDING`: conserva sólo pendientes, con nuevos IDs, mismo orden/datos (incluida categoría)
  y `checked=false`.

Completar utiliza un endpoint distinto y cierra el ciclo como `COMPLETED`; nunca ocurre de forma
automática.

## Canal en tiempo real

`GET /ws` actualiza la conexión a WebSocket. El cliente ofrece los subprotocolos
`family-shopping` y `bearer.<device-token>`; no se admiten credenciales en la query string. El Worker
autoriza el dispositivo antes de conectarlo al Durable Object de su hogar.

Cada aviso es JSON con `version: 1`, `id`, `type`, `householdId`, `revision`, `occurredAt` y
`payload`. Los tipos actuales son `ITEM_CREATED`, `ITEM_UPDATED`, `ITEM_CHECKED`,
`ITEM_UNCHECKED`, `ITEM_DELETED`, `LIST_CLOSED`, `LIST_REPLACED` y `SETTINGS_UPDATED`. Los eventos
de lista recargan el ciclo; el de ajustes vuelve a leer la preferencia y los precios visibles.

## Vinculación

Un dispositivo autorizado crea un código corto aleatorio mediante `POST /api/pairings`. La respuesta
incluye `code`, `expiresAt` y una URL `/pair?code=...`. El código dura diez minutos, se guarda sólo
como SHA-256 y se consume una vez mediante el endpoint público `POST /api/pairings/consume`.

El consumo no lleva `Authorization`: el código temporal es la credencial limitada de ese flujo. La
respuesta contiene un device token nuevo; nunca reutiliza ni copia el token del dispositivo creador.

## Administración de imports

Los endpoints de importación usan `x-import-admin-key` con el secret independiente
`IMPORT_ADMIN_KEY`; un device token familiar no concede permisos administrativos.

| Método | Ruta                           | Resultado                           |
| ------ | ------------------------------ | ----------------------------------- |
| `GET`  | `/api/admin/imports`           | Últimas ejecuciones y métricas.     |
| `POST` | `/api/admin/imports/carrefour` | Import manual acotado de Carrefour. |
| `POST` | `/api/admin/imports/dia`       | Import manual acotado de DIA.       |
| `POST` | `/api/admin/imports/lidl`      | Import manual acotado de Lidl.      |

El `POST` admite `limit=1..20`; Lidl admite `limit=1..100` para repartir un límite global entre un
máximo de diez campañas. Exige siempre `IMPORT_ADMIN_KEY`, independientemente del flag visible, de
modo que una importación controlada puede validarse antes de habilitar la UI. Las respuestas nunca
incluyen HTML remoto, cookies, stack traces ni secretos.

El endpoint DIA descubre las tiendas oficiales de Zafra y consulta la página pública de ofertas.
Los precios de esta última se etiquetan `ONLINE`; no se atribuyen a una tienda física. En la
validación del 28 de agosto de 2026, DIA redirigió las peticiones desde el runtime Cloudflare a
`/error`, por lo que la ejecución termina de forma encapsulada en `FAILED` y no persiste productos.

El endpoint Lidl descubre desde la portada oficial las campañas alimentarias vigentes/próximas y la
tienda oficial de Zafra. Extrae exclusivamente el JSON estructurado embebido en fichas públicas,
selecciona la región Badajoz declarada por Lidl y persiste el catálogo con scope `REGIONAL`; nunca
lo presenta como stock ni como precio específico de la tienda de Zafra. El visor de folletos se
conserva sólo para metadata y no se procesa mediante OCR.

## Consulta de ofertas por categoría

`GET /api/offers` admite `supermarket` y `category`. Una categoría desconocida devuelve
`INVALID_OFFER_CATEGORY`. La respuesta incluye `categories` con código, label, emoji y contador en
una sola agregación; no hace una query por chip. El catálogo devuelve siempre
`relatedToList=false`: la relación familiar sólo se obtiene desde `GET /api/offers/for-list`.

`category` utiliza `OfferBrowseCategory`, no `ProductCategory`. El endpoint sigue protegido por
device token y tolera fallos parciales de providers. Las fechas vigentes/próximas y el scope
regional no cambian.
