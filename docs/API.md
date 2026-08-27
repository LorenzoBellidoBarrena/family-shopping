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

| Método | Ruta                       | Resultado                                                     |
| ------ | -------------------------- | ------------------------------------------------------------- |
| `GET`  | `/api/health`              | Salud del Worker.                                             |
| `POST` | `/api/bootstrap/household` | Crea el único hogar, primer device y ciclo activo.            |
| `POST` | `/api/pairings/consume`    | Consume una vez un código no caducado y entrega device token. |

Bootstrap recibe `accessKey`, `householdName` opcional y `deviceName` opcional. Si el hogar ya está
inicializado devuelve `409`, incluso aunque la clave sea correcta.

## Rutas privadas

| Método   | Ruta                                   | Resultado                                                   |
| -------- | -------------------------------------- | ----------------------------------------------------------- |
| `POST`   | `/api/pairings`                        | Código de ocho caracteres, URL y expiración a diez minutos. |
| `GET`    | `/api/shopping-cycle/active`           | Ciclo activo con items en orden estable.                    |
| `POST`   | `/api/items`                           | Añade un producto.                                          |
| `PATCH`  | `/api/items/:id`                       | Edita nombre, cantidad, unidad o supermercado.              |
| `DELETE` | `/api/items/:id`                       | Elimina un producto; devuelve `204`.                        |
| `POST`   | `/api/items/:id/toggle`                | Marca/desmarca sin alterar `sortOrder`.                     |
| `POST`   | `/api/shopping-cycle/complete`         | Completa sólo si hay productos y todos están marcados.      |
| `POST`   | `/api/shopping-cycle/clear`            | Ejecuta `CANCEL`, `CLEAR_ALL` o `CARRY_PENDING`.            |
| `GET`    | `/api/supermarkets`                    | Supermercados activos ordenados.                            |
| `GET`    | `/api/product-preferences/suggestions` | Preferencias por frecuencia y prefijo normalizado.          |

## Producto

Creación completa:

```json
{
  "name": "Leche",
  "quantity": "1.5",
  "unit": "litro",
  "supermarketId": "lidl"
}
```

Sólo `name` es obligatorio; los defaults son cantidad `"1"`, unidad `"unidad"` y supermercado
`null`. Un `PATCH` conserva cualquier campo omitido.

Unidades: `unidad`, `pack`, `kg`, `g`, `litro`, `ml`, `caja`, `botella`, `otro`.

## Vaciar

```json
{ "action": "CARRY_PENDING" }
```

- `CANCEL`: no modifica nada.
- `CLEAR_ALL`: cierra como `CLEARED` y crea una lista vacía.
- `CARRY_PENDING`: conserva sólo pendientes, con nuevos IDs, mismo orden/datos y `checked=false`.

Completar utiliza un endpoint distinto y cierra el ciclo como `COMPLETED`; nunca ocurre de forma
automática.

## Canal en tiempo real

`GET /ws` actualiza la conexión a WebSocket. El cliente ofrece los subprotocolos
`family-shopping` y `bearer.<device-token>`; no se admiten credenciales en la query string. El Worker
autoriza el dispositivo antes de conectarlo al Durable Object de su hogar.

Cada aviso es JSON con `version: 1`, `id`, `type`, `householdId`, `revision`, `occurredAt` y
`payload`. Los tipos actuales son `ITEM_CREATED`, `ITEM_UPDATED`, `ITEM_CHECKED`,
`ITEM_UNCHECKED`, `ITEM_DELETED`, `LIST_CLOSED` y `LIST_REPLACED`. El aviso indica que hay una nueva
versión; el cliente vuelve a leer `/api/shopping-cycle/active` para reconciliarse con D1.
