# Arquitectura

## Vista general

```text
Android / PWA
  ├─ HTTPS + Bearer token ──────► Worker /api ──► D1 (fuente de verdad)
  ├─ WebSocket subprotocol ─────► Worker /ws ──► Durable Object por household
  │                                               └─ broadcast, sin datos de dominio
  └─ IndexedDB ◄── lista canónica y toggles pendientes
```

Angular es una SPA client-side standalone, estricta y mobile-first. No hay SSR. Static Assets sirve
`dist/family-shopping/browser` y aplica fallback de SPA. El Worker se ejecuta primero únicamente
para `/api/*` y `/ws/*`, por lo que los assets no consumen ejecución innecesaria.

## Estado del frontend

- `core/shopping-api.service.ts`: única capa HTTP; añade el Bearer token y traduce errores seguros.
- `core/device-token.store.ts`: persiste el token del dispositivo en `localStorage`.
- `core/offline-cache.service.ts`: ciclo guardado y cola de toggles por item en IndexedDB.
- `core/realtime.service.ts`: WebSocket, eventos versionados, deduplicación y backoff exponencial.
- `state/shopping.store.ts`: Signals, reconciliación canónica y todas las operaciones.
- `app.ts` y `app.html`: presentación e interacciones, sin llamadas HTTP directas.
- `app.scss`: se compila como stylesheet global externo. No se declara como estilo encapsulado del
  componente porque Angular lo inyectaría mediante `<style>` y la CSP estricta lo bloquearía.
- `app.routes.ts`: reconoce `/` y `/pair` sin guard de autenticación; el shell evalúa primero la
  invitación y después la presencia de device token.
- `shared/product-category.ts`: única fuente para códigos, labels, emojis, orden visual y reglas
  deterministas de clasificación; la comparten Angular y el Worker.

El store reemplaza items en su índice actual al marcar o editar, por lo que nunca ordena por estado
`checked`. Un evento remoto o una reconexión dispara una lectura canónica de D1. Los eventos tienen
`version` y `revision`; revisiones repetidas o antiguas se descartan en el cliente.

## Capas del Worker

- `routes/api-router.ts`: contrato HTTP, métodos, códigos y autorización por ruta.
- `services/auth-service.ts`: bootstrap, emisión de tokens y pairing temporal.
- `services/shopping-service.ts`: validación y casos de uso de la lista.
- `repositories/d1-repository.ts`: SQL parametrizado y operaciones atómicas D1.
- `domain/types.ts`: contratos internos sin dependencia HTTP.
- `security/tokens.ts`: aleatoriedad criptográfica, SHA-256 y comparación de claves.
- `durable-objects/household-coordinator.ts`: Hibernation API y broadcast por hogar.
- `services/realtime-publisher.ts`: incrementa la revisión tras persistir y publica el evento.
- `services/offers-service.ts`: agrega proveedores con tolerancia a fallos y relaciona ofertas.
- `services/list-offer-matching-service.ts`: genera candidatos Lidl desde D1, aplica preferencias y
  separa sugerencia de match automático.
- `services/product-matching.ts`: tokenización, aliases, contradicciones y scoring puro/explicable.
- `services/package-matching.ts`: parser de envases, conversiones, ajuste y costes promocionales.
- `services/effective-price.ts`: selecciona el menor coste inmediato aplicable y explica la razón.
- `services/household-loyalty-service.ts`: preferencia loyalty autenticada y compartida por hogar.
- `repositories/product-match-repository.ts`: catálogo actual en bloque y preferencias por hogar.
- `providers/*-provider.ts`: adaptadores independientes de Lidl, Mercadona, Carrefour y DIA.
- `domain/supermarkets.ts`: contrato `SupermarketProvider` y tipos de catálogo independientes.
- `domain/supermarket-import.ts`: contrato real de discovery, fetch, parsing y normalización.
- `providers/carrefour-import-provider.ts`: implementación pública allowlisted; `CarrefourProvider`
  es su exportación estable y el proveedor demo queda separado como fixture.
- `providers/lidl-provider.ts`: discovery oficial de campañas/tienda, fetch allowlisted y parser del
  JSON estructurado de fichas con precio regional Badajoz; `lidl-fixture-provider.ts` mantiene
  separada la demostración de la pestaña Ofertas.
- `services/supermarket-import-service.ts`: orquestación tolerante a errores, staging previo a
  persistencia, sanity checks y lock Lidl contra ejecuciones solapadas.
- `repositories/supermarket-import-repository.ts`: persistencia D1 e idempotencia de snapshots.
- `scheduled/lidl-schedule.ts`: guard `Europe/Madrid` para ejecutar Lidl una vez al día a las 05:00
  locales a partir de dos triggers UTC.

`GET /api/offers` forma una rama independiente del dominio de lista. Consulta proveedores con
`Promise.allSettled`, de modo que un fallo sólo marca la respuesta como parcial. En modo real lee
el catálogo Lidl persistido y calcula la fecha visible desde el último `import_runs.SUCCESS`; los
fixtures demo permanecen aislados y no se mezclan con datos reales.

`GET /api/offers/for-list` es otra lectura privada, también independiente del flujo de compra. Lee
en paralelo ciclo, catálogo Lidl vigente, aliases del hogar, ofertas persistidas y último import
correcto. No hace N+1 por item y nunca consulta Internet. Crear, editar o marcar un item continúa
teniendo la misma latencia y semántica; el matching se solicita sólo al abrir o actualizar Ofertas.

## Matching de intención familiar

El item conserva su nombre, cantidad, unidad, supermercado, categoría, estado y `sort_order`. El
matcher crea una vista adicional: intención normalizada → candidatos comerciales → score →
confianza. Reutiliza `normalizeProductName`, compara tokens completos, elimina sólo stop words de
formato, aplica un diccionario corto de singular/plural y sinónimos, penaliza variantes
contradictorias y utiliza `ProductCategory` únicamente como evidencia. Compartir categoría nunca
basta para relacionar, por ejemplo, leche con queso.

Una preferencia `CONFIRMED` obtiene prioridad máxima y se guarda en `product_aliases` por
household, nombre normalizado y supermercado. Una preferencia `DISMISSED` impide la selección
automática pero no oculta posibles correcciones manuales. Si el producto confirmado deja de estar
en el último catálogo publicado, se omite y se reabre la generación de candidatos. Sólo `HIGH` con
una ventaja mínima frente al segundo candidato se elige heurísticamente; `MEDIUM` se presenta como
«¿Es alguno de estos?» y `LOW` se descarta.

La UI abre con «Ofertas de tu lista», prioriza pendientes con oferta activa y conserva juntas las
filas general y Lidl Plus de un mismo producto. A continuación muestra candidatos que requieren
revisión, luego el resto de ofertas Lidl y finalmente las próximas. Una selección manual aprende
para ciclos futuros; quitarla no modifica nunca el shopping item.

## Cantidades y formatos Lidl

La identidad y el ajuste de envase son capas independientes. Después de filtrar candidatos, un
`PackageDescriptor` interpreta el texto persistido: envase medido, multipack, unidades explícitas,
granel o formato desconocido. Masa se normaliza a gramos y volumen a mililitros; `cl` se convierte
inmediatamente a `ml`. La cantidad familiar sigue almacenada en milésimas y no se reescribe.

`calculatePackageFit` devuelve `EXACT`, `GOOD`, `OVERBUY`, `UNKNOWN` o `INCOMPATIBLE`, número de
envases, cantidad comprada y exceso cuando son fiables. Un peso aproximado nunca publica un exceso
exacto. `UNIT` puede representar un envase individual; los multipacks sólo se cuentan cuando el
formato/identidad hacen inequívocas sus unidades internas. `PACK` siempre representa paquetes de
venta y no unidades interiores.

`PromotionCalculator` usa enteros: precio publicado para descuentos simples/porcentaje, grupos
completos para `BUY_X_PAY_Y` y descuento sólo en cada segunda unidad para
`SECOND_UNIT_DISCOUNT`. Cashback no se trata como ahorro inmediato. Regular, oferta general y Lidl
Plus permanecen escenarios separados. Para granel se usa precio unitario únicamente si la fuente
publica una unidad compatible; el resultado se redondea al céntimo más próximo, mitad hacia arriba,
y se etiqueta estimado.

## Precio efectivo y fidelización

La identidad del producto, el ajuste de envase y la aplicabilidad del precio son tres capas
separadas. `EffectivePriceCalculator` recibe los costes ya calculados y el estado del programa del
hogar. Escoge el menor precio inmediato entre regular, oferta general vigente y loyalty vigente
sólo si su estado es `ENABLED`. `UNKNOWN` y `DISABLED` usan el mejor precio no loyalty; `UNKNOWN`
puede exponer el posible coste Lidl Plus sin aplicarlo.

La respuesta conserva todos los escenarios y añade una razón segura: `REGULAR`, `GENERAL_OFFER`,
`LOYALTY` o `QUANTITY_PROMOTION`. Cashback no se convierte en descuento inmediato. La tabla y los
contratos admiten `CLUB_DIA` y `CLUB_CARREFOUR`, pero no se exponen ni implementan todavía.

Un cambio emite `SETTINGS_UPDATED` por el Durable Object del hogar. El dispositivo origen actualiza
su señal directamente y los demás vuelven a leer la preferencia y, si estaban mostrando Ofertas,
los precios calculados. No se amplía la cola offline: la lista sigue disponible sin conexión, pero
la preferencia loyalty sólo se modifica online.

D1 es la fuente persistente de verdad. Los cierres, la creación del siguiente ciclo y el copiado de
pendientes se confirman en un único `D1.batch`. El Durable Object no guarda una copia del dominio:
usa WebSocket Hibernation y difunde eventos sólo después de confirmar D1. Si falla una difusión, la
mutación REST permanece válida y la siguiente reconexión recupera el estado canónico.

El importador es una rama administrativa independiente. Sus fallos no atraviesan el store Angular,
las rutas de lista, pairing ni el Durable Object. Sólo acepta hosts y rutas Carrefour predefinidos,
limita URLs descubiertas, tiempo y tamaño de respuesta, valida datos en runtime y persiste SQL
parametrizado. Lidl añade la allowlist cerrada de campañas en `www.lidl.es` y conserva
`endpoints.leaflets.schwarz` sólo para metadata del visor oficial, sin dar acceso a URLs
proporcionadas por el usuario. El handler `scheduled` invoca directamente el importador Lidl. Los
triggers `0 3 * * *` y `0 4 * * *` cubren CET y CEST, mientras un guard con timezone
`Europe/Madrid` permite ejecutar únicamente cuando la hora local es 05:00. El trigger no válido se
omite sin crear un run. Carrefour, DIA y Mercadona no forman parte del scheduled.

Antes de persistir Lidl, el importador prepara y valida todo el lote. Un resultado vacío o una caída
extrema se registra como fallo y deja intacto el último dataset válido. Un `RUNNING` reciente actúa
como lock durante 15 minutos; los locks antiguos se cierran como stale. El histórico de precios
sigue insertando una fila sólo cuando cambia el precio y las ofertas antiguas no se eliminan.

## Categoría visual de producto

`ProductCategory` describe la familia visual del producto y es independiente de `checked`. La
categoría se persiste en el item: no se recalcula al renderizar y el emoji no cambia al marcarlo.
Al crear, el Worker reutiliza `normalizeProductName` y resuelve en este orden: categoría aprendida
en `product_preferences`, reglas locales por palabras completas y `OTHER`. Una categoría enviada
explícitamente representa una elección de usuario y se guarda también en la preferencia. No existe
una fuente externa ni un modelo de IA.

La columna libre `category` de `external_products` pertenece a la taxonomía comercial de cada
proveedor. Se mantiene separada para no degradar una jerarquía futura más detallada. El catálogo
real añade `visual_category` mediante mapping explícito y el matching puede usar ambas como señales,
sin reemplazar ninguna taxonomía ni tratarlas como identidad suficiente.

Los eventos de item ya transportaban el item completo, por lo que `category` viaja en
`ITEM_CREATED` y `ITEM_UPDATED` sin versionar de nuevo el protocolo. El cliente sigue usando el
evento como invalidación y recarga D1. IndexedDB guarda el ciclo completo; al leer una caché antigua
sin categoría se aplica `OTHER` de forma compatible.

## Seguridad sin usuarios

El primer bootstrap compara `HOUSEHOLD_ACCESS_KEY` y deja de estar disponible cuando existe el
singleton `app_state`. Se genera un token aleatorio de 256 bits; el cliente recibe el valor una sola
vez y D1 almacena únicamente su SHA-256 hexadecimal.

Bootstrap y pairing son flujos separados. La clave familiar sólo llega a `POST /api/bootstrap`. El
código temporal sólo llega a `POST /api/pairings/consume`; su consumo crea otro device del mismo
hogar con un token aleatorio independiente.

Las APIs privadas exigen `Authorization: Bearer <device-token>`. El WebSocket lleva la credencial
en el subprotocolo `bearer.<token>`, nunca en la URL. El pairing sólo puede generarlo un
dispositivo autorizado, dura diez minutos y el consumo se registra de forma atómica. Un código
caducado, usado o inexistente obtiene la misma respuesta para no revelar su estado.

## Por qué un único Worker

- Frontend y API comparten origen, evitando CORS.
- Hay una sola unidad de despliegue y configuración.
- D1 y Durable Objects permanecen junto a la capa que autoriza el acceso.
- Reduce operación y coste para un proyecto familiar pequeño.

La PWA precachea sólo la shell y los recursos estáticos. Las respuestas privadas de `/api` no se
guardan en Cache Storage; la copia offline controlada vive en IndexedDB. Véase [OFFLINE.md](OFFLINE.md).

## Aislamiento de rendimiento entre Lista y Ofertas

`ShoppingStore` conserva exclusivamente ciclo, CRUD, preferencias, conexión y ajustes familiares.
`OffersStore` posee catálogo, categorías, matching, caché y carga de Ofertas. La dependencia es de
Ofertas hacia la versión de Lista, nunca al revés. Entrar en Ofertas inicia catálogo y matching bajo
demanda; salir aborta ambas peticiones HTTP. Una mutación de lista sólo incrementa una versión local
y el matching se recalcula la próxima vez que Ofertas esté activa.

Alta, edición, toggle y borrado actualizan primero la señal local y hacen rollback si falla el
servidor. La respuesta REST sigue siendo el item mutado. El Durable Object excluye de broadcast al
dispositivo origen; otros dispositivos conservan una reconciliación canónica completa por evento,
además de la recuperación completa al reconectar. Con el volumen familiar actual, se prioriza esa
corrección sobre introducir un segundo modelo incremental de conflictos.

`GET /api/offers` ya no lee el ciclo ni ejecuta matching. `GET /api/offers/for-list` es el único
camino que relaciona lista y catálogo y sólo se invoca desde la vista Ofertas. El cliente mantiene
catálogo cinco minutos por cadena/categoría/estado loyalty y matching por versión de lista. El
provider D1 comparte únicamente consultas simultáneas dentro del isolate y las invalida al terminar;
la vigencia real continúa determinada por el último import persistido.

No se añadió un chunk lazy de Angular: la aplicación sigue siendo un shell standalone único y la
vista de Ofertas está en el mismo template. La medición mostró que el problema era trabajo HTTP/D1
que sobrevivía a la navegación, no evaluación de Signals. Separar el estado y cancelar I/O elimina
la interferencia sin una reescritura riesgosa del routing; `@for` sigue usando IDs estables.
