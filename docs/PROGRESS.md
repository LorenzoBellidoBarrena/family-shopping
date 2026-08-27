# Progreso

## Fase actual: Prompt 4 — Tiempo real, PWA y modo offline

Estado: completada el 27 de agosto de 2026.

### Implementado

- Durable Object por hogar con WebSocket Hibernation y broadcast excluyendo al dispositivo origen.
- Autorización WebSocket mediante device token en subprotocolo, sin credenciales en URLs.
- Eventos v1 con revisión D1 creciente; D1 sigue siendo la única fuente de verdad.
- Reconexión con backoff exponencial, deduplicación de revisiones y recarga canónica.
- Manifest instalable, iconos propios, service worker y caché exclusiva de la shell estática.
- Última lista en IndexedDB y vista offline claramente indicada.
- Cola de toggles por estado final deseado, posición estable y reconciliación determinista.
- Pairing desde Ajustes mediante QR/código temporal, cuenta atrás y pantalla de consumo.
- Controles que necesitan servidor deshabilitados offline; marcar/desmarcar continúa disponible.

### Verificación

- 11 pruebas Angular, incluidas actualización remota, reconexión, orden, operación offline y sync.
- 18 pruebas Worker/D1, incluidas autorización WebSocket y broadcast entre dos dispositivos.
- Migración `0002_realtime_revisions.sql` aplicada sólo a D1 local.
- TypeScript estricto, ESLint, Prettier, build PWA y `wrangler deploy --dry-run` correctos.
- El build contiene manifest, `ngsw.json`, worker de servicio e iconos. No se tocó ningún recurso remoto.

### Deliberadamente pendiente

- Configuración y despliegue de recursos Cloudflare de producción.
- Prueba manual en dos móviles Android físicos y validación del prompt de instalación del navegador.
- Revocación explícita de dispositivos y Content Security Policy endurecida.
- Módulo de ofertas reales.

### Acción manual

No se requiere ninguna acción manual para cerrar esta fase. Las pruebas físicas y el despliegue se
reservan para prompts posteriores.
