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
- `providers/*-provider.ts`: adaptadores independientes de Lidl, Mercadona, Carrefour y DIA.
- `domain/supermarkets.ts`: contrato `SupermarketProvider` y tipos de catálogo independientes.

`GET /api/offers` forma una rama independiente del dominio de lista. Consulta proveedores con
`Promise.allSettled`, de modo que un fallo sólo marca la respuesta como parcial. El esquema D1 está
preparado para persistencia futura, pero en Prompt 6 los adaptadores devuelven únicamente fixtures
explícitos y no realizan solicitudes a webs de supermercados.

D1 es la fuente persistente de verdad. Los cierres, la creación del siguiente ciclo y el copiado de
pendientes se confirman en un único `D1.batch`. El Durable Object no guarda una copia del dominio:
usa WebSocket Hibernation y difunde eventos sólo después de confirmar D1. Si falla una difusión, la
mutación REST permanece válida y la siguiente reconexión recupera el estado canónico.

## Categoría visual de producto

`ProductCategory` describe la familia visual del producto y es independiente de `checked`. La
categoría se persiste en el item: no se recalcula al renderizar y el emoji no cambia al marcarlo.
Al crear, el Worker reutiliza `normalizeProductName` y resuelve en este orden: categoría aprendida
en `product_preferences`, reglas locales por palabras completas y `OTHER`. Una categoría enviada
explícitamente representa una elección de usuario y se guarda también en la preferencia. No existe
una fuente externa ni un modelo de IA.

La columna libre `category` de `external_products` y `product_aliases` pertenece a la taxonomía
comercial de cada proveedor. Se mantiene separada para no degradar una jerarquía futura más
detallada. Si se incorporan catálogos reales se añadirá un mapping explícito hacia
`ProductCategory`; el matching actual no cambia.

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
