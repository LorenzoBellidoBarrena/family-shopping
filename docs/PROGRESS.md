# Progreso

## Fase actual: fundamento real de Carrefour

Estado: completado y desplegado en producción el 28 de agosto de 2026.

### Implementado

- Fase 1 publicada y aislada en el commit `3dcf317`; D1 `0001`–`0004`, PWA, Worker, Static Assets,
  Durable Object SQLite y smoke tests verdes.
- Migración aditiva `0005_carrefour_import_foundation.sql` validada en D1 local.
- `CarrefourProvider` con discovery/fetch/parser/normalización separados, allowlist, timeout y límite
  de tamaño; no evade el bloqueo observado en la fuente.
- `import_runs`, histórico de precios por cambio y promociones estructuradas e idempotentes.
- Fixtures mínimos de precio normal, directo, 3x2, segunda unidad, cashback y sitemap/paginación.
- Endpoints administrativos con `IMPORT_ADMIN_KEY` independiente del device token.
- Handler scheduled preparado, feature flag desactivado y ningún cron configurado.
- Código de la fundación desplegado sin ejecutar imports remotos; producción conserva cero
  `import_runs` y cero `external_products`.

- `ProductCategory` compartido con 20 códigos estables y configuración central de label, emoji y
  orden futuro.
- Clasificador local por preferencia aprendida, keywords normalizadas y fallback `OTHER`, sin APIs
  externas ni IA.
- Migración aditiva `0004_product_categories.sql`: categoría persistida en items y preferencias,
  con backfill seguro `OTHER` para datos existentes.
- Lista y habituales muestran el emoji de categoría; el botón de fila conserva semántica accesible,
  tachado, menor énfasis, doble toggle y posición original.
- El editor permite corregir categoría y la preferencia normalizada conserva esa corrección para
  altas posteriores.
- Categoría conservada en `CARRY_PENDING`, respuestas REST, eventos WebSocket y ciclo de IndexedDB.
- Taxonomía visual separada de la categoría comercial libre del módulo de supermercados.

- Prueba manual del MVP confirmada por el propietario en dos móviles físicos.
- Módulo aislado mediante `SupermarketProvider` y adaptadores independientes para Lidl,
  Mercadona, Carrefour y DIA.
- Migración `0003_supermarket_catalog.sql` para tiendas, productos externos, publicación en
  catálogo, aliases, precios históricos y ofertas en céntimos.
- Ocho fixtures explícitos, normalización con aliases y coincidencias destacadas con la lista.
- Pestaña Ofertas con filtros por cadena y aviso de datos demo/disponibilidad no confirmada.
- Fallos parciales tolerados sin afectar la lista ni las otras cadenas.
- Evaluación de fuentes oficiales y recomendación técnica en `docs/SUPERMARKETS.md`.

- Durable Object por hogar con WebSocket Hibernation y broadcast excluyendo al dispositivo origen.
- Autorización WebSocket mediante device token en subprotocolo, sin credenciales en URLs.
- Eventos v1 con revisión D1 creciente; D1 sigue siendo la única fuente de verdad.
- Reconexión con backoff exponencial, deduplicación de revisiones y recarga canónica.
- Manifest instalable, iconos propios, service worker y caché exclusiva de la shell estática.
- Última lista en IndexedDB y vista offline claramente indicada.
- Cola de toggles por estado final deseado, posición estable y reconciliación determinista.
- Pairing desde Ajustes mediante QR/código temporal, cuenta atrás y pantalla de consumo.
- Onboarding sin ambigüedad entre `Clave familiar` y `Código de vinculación`, con `/pair` prioritario.
- Controles que necesitan servidor deshabilitados offline; marcar/desmarcar continúa disponible.
- Cabeceras CSP/HSTS y políticas de seguridad tanto en API como en Workers Static Assets.
- Build compatible con CSP estricta, sin estilos ni manejadores inline.
- Estilos de la aplicación extraídos al CSS externo para evitar que CSP bloquee la inyección
  encapsulada de Angular; corrección desplegada y comprobada en producción.
- Límite de 16 KiB para cuerpos JSON y respuestas privadas `no-store`.

### Verificación

- 27 pruebas Angular, incluidas clasificación, emojis, accesibilidad, orden y caché offline.
- 41 pruebas Worker/D1, incluidas lista, WebSocket, parser Carrefour, seguridad, import e
  idempotencia.
- Migraciones `0001`, `0002`, `0003` y `0004` aplicadas y comprobadas en D1 local.
- TypeScript estricto, ESLint, Prettier, build PWA y smoke local correctos.
- El build contiene manifest, `ngsw.json`, worker de servicio e iconos. No se tocó ningún recurso remoto.

### Producción

La versión completa con categorías visuales está desplegada. La migración fue aditiva y conservó el
hogar, los dos dispositivos, el ciclo activo y los productos existentes.

- Wrangler está autenticado mediante OAuth.
- D1 `family-shopping-db` fue creada en `WEUR` y su ID real está en `wrangler.jsonc`.
- `HOUSEHOLD_ACCESS_KEY` existe con el nombre correcto y no hay secretos inesperados.
- Migraciones `0001` y `0002` aplicadas; no quedan migraciones remotas pendientes.
- `npm run verify` pasó antes del deploy.
- URL: `https://family-shopping.lorenzo-bellido-b.workers.dev`.
- Worker, Angular Static Assets, D1 y Durable Object comparten despliegue y origen.
- Preview URLs deshabilitadas explícitamente.
- Smoke tests: shell, manifest, service worker, `/pair` y salud responden `200`; API privada sin
  token y upgrade WebSocket sin credencial responden `401`; `/ws` sin upgrade responde `426`.
- Migración remota `0003_supermarket_catalog.sql` aplicada; no quedan migraciones pendientes.
- Prompt 6 desplegado en `https://family-shopping.lorenzo-bellido-b.workers.dev`.
- Versión de Worker: `0a5998f3-14f1-4c42-95aa-6c18cfd11e0b`.
- Smoke de producción: shell, JS, CSS y salud responden `200`; bundles contienen la vista y API de
  ofertas; `/api/offers` sin token responde `401`.
- Comprobación D1 de sólo lectura confirmó el hogar, dos dispositivos y productos existentes; las
  tablas nuevas existen y están vacías porque los fixtures no se persisten.
- Migración remota `0004_product_categories.sql` aplicada; no quedan migraciones pendientes.
- Seed idempotente confirmado con `LIDL`, `MERCADONA`, `CARREFOUR`, `DIA` y `ANY`.
- Versión actual de Worker: `f5ba83b1-1686-49ec-b9cd-c6de20197cc0`.
- Smoke actual: shell Angular, `/pair`, manifest, service worker, `ngsw.json`, CSS y salud responden
  `200`; `/api/unknown` devuelve JSON `404`; API privada y upgrade WebSocket con credencial inválida
  devuelven `401`; `/ws` sin upgrade devuelve `426`.
- PWA publicada con `display: standalone`, HTTPS y mismo origen para Angular, API y WebSocket.
- Migración remota `0005_carrefour_import_foundation.sql` aplicada; no quedan pendientes.
- Fundación Carrefour desplegada en la versión `12a5eb2a-b17e-4e30-a193-2c82f6de74e3` con
  `SUPERMARKET_FEATURE_ENABLED=false`, `crons: []` y sin `IMPORT_ADMIN_KEY`.
- Smoke posterior: lista y `/pair` `200`, salud `200`, API desconocida JSON `404` y endpoints de
  importación `503` por configuración deliberadamente ausente.

### Deliberadamente pendiente

- Reglas nativas remotas de rate limiting.
- Revocación explícita de dispositivos y Content Security Policy endurecida.
- Descarga real de Carrefour: la fuente pública bloqueó la petición conservadora; requiere permiso
  o feed oficial. No se intentó evasión y no se importó ningún dato remoto.
- Comparador `¿Dónde sale más barato?`, hasta disponer de datos equivalentes y completos.

### Acción manual

No se requiere ninguna acción de infraestructura. Conviene abrir la aplicación en ambos móviles y
confirmar visualmente el emoji, el tachado y la actualización en tiempo real; `CARRY_PENDING` no se
ejecutó sobre la lista personal y queda cubierto por las pruebas automatizadas.
