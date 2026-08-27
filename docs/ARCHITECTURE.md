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

D1 es la fuente persistente de verdad. Los cierres, la creación del siguiente ciclo y el copiado de
pendientes se confirman en un único `D1.batch`. El Durable Object no guarda una copia del dominio:
usa WebSocket Hibernation y difunde eventos sólo después de confirmar D1. Si falla una difusión, la
mutación REST permanece válida y la siguiente reconexión recupera el estado canónico.

## Seguridad sin usuarios

El primer bootstrap compara `HOUSEHOLD_ACCESS_KEY` y deja de estar disponible cuando existe el
singleton `app_state`. Se genera un token aleatorio de 256 bits; el cliente recibe el valor una sola
vez y D1 almacena únicamente su SHA-256 hexadecimal.

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
