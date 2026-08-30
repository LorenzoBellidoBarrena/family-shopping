# Progreso

## Fase actual: configuración familiar Lidl Plus y precio efectivo

Estado: cada hogar puede declarar si utiliza Lidl Plus y el Worker selecciona el menor precio
inmediato realmente aplicable sin perder normal, oferta general, loyalty ni desglose. Identidad,
cantidades, lista y automatización diaria permanecen independientes.

### Implementado

- Migración aditiva `0009_household_loyalty_programs.sql`, aislada por hogar y extensible a
  `CLUB_DIA`/`CLUB_CARREFOUR`; hogares existentes quedan `UNKNOWN` sin backfill.
- Endpoints privados GET/PUT que derivan el hogar del device token y validan programa/estado en
  runtime. No se aceptan households arbitrarios ni se almacenan credenciales Lidl.
- `EffectivePriceCalculator` central: menor coste inmediato regular/general/loyalty, razones
  seguras, potencial Lidl Plus y ahorros general/adicional/total. Cashback conserva el pago actual.
- Ajustes con Sí/No/estado neutro, bloqueo offline, feedback de carga/error y actualización en el
  segundo móvil mediante `SETTINGS_UPDATED` y refetch.
- Ofertas generales y de la lista muestran `Tu precio`; Lidl Plus sólo se prioriza cuando el hogar
  lo habilita. `UNKNOWN` sugiere configurarlo sin aplicarlo silenciosamente.

- `PackageDescriptor` determinista para `750 g`, `1 kg`, multipacks como `3x65 g` y `18x33 cl`,
  unidades explícitas, `Aprox.`, `A granel` y formatos desconocidos. `cl` se normaliza a `ml`.
- Capa de ajuste independiente del score de identidad: `EXACT`, `GOOD`, `OVERBUY`, `UNKNOWN` e
  `INCOMPATIBLE`, con envases, cantidad comprada y exceso sólo cuando son fiables.
- `UNIT` cuenta envases simples; multipacks sólo cuando su formato/identidad permite afirmar las
  unidades interiores. `PACK` conserva semántica propia. `KG/G` y `L/ML` se convierten de forma
  segura usando la cantidad familiar ya almacenada en milésimas.
- `PromotionCalculator` entero para precio publicado, porcentaje, `BUY_X_PAY_Y`, segunda unidad y
  loyalty. Regular, oferta general y Lidl Plus se devuelven como escenarios separados; cashback no
  se presenta como descuento inmediato.
- Granel calculable sólo con precio unitario compatible, redondeado al céntimo más próximo con
  mitad hacia arriba y siempre marcado como estimado. Sin precio unitario queda `UNKNOWN`.
- Migración aditiva `0008_package_descriptions.sql`: conserva el formato original del catálogo y
  hace backfill seguro; packs, excesos y costes no se persisten.
- UI ampliada con cantidad solicitada, formato, envases necesarios, compra/exceso y total estimado,
  sin saturar candidatos desconocidos ni incompatibles.
- Revisión de 10 formatos/precios del catálogo Lidl real vigente y casos adicionales de granel/
  formato desconocido, sin modificar la lista familiar de producción.

- `GET /api/offers/for-list` autenticado genera hasta cinco candidatos por item pendiente usando
  sólo el último catálogo Lidl válido de D1; no hace fetch remoto ni acepta household arbitrario.
- Scoring explícito con tokens completos, aliases/plurales pequeños, igualdad exacta, categoría
  visual/comercial, preferencia de supermercado, variantes contradictorias y penalización de
  productos derivados. `HIGH >= 75`, `MEDIUM >= 45`; `LOW` se descarta.
- Match heurístico automático sólo cuando es `HIGH` y aventaja al segundo candidato en 15 puntos.
  Los casos genéricos o ambiguos permanecen `MEDIUM` y requieren selección manual.
- Migración aditiva `0007_household_product_matches.sql`: amplía `product_aliases` con hogar,
  supermercado, producto externo, estado confirmado/descartado e índices parciales, conservando
  aliases previos.
- Confirmación, corrección y descarte mediante rutas privadas. La preferencia se guarda por hogar y
  nombre normalizado, sobrevive a ciclos/Habituales/CARRY_PENDING y nunca cambia el shopping item.
- Catálogo desaparecido: un producto confirmado que ya no aparece en el último import correcto no
  se devuelve; se reabre la búsqueda de candidatos vigentes.
- «Ofertas de tu lista» prioriza matches pendientes con promoción, conserva oferta general y Lidl
  Plus, calcula ahorro en céntimos y deja el resto bajo «Todas las ofertas Lidl». Los candidatos
  `MEDIUM` aparecen en una revisión manual no bloqueante.
- Supermercado preferido respetado: `LIDL`, `ANY` y vacío permiten candidatos Lidl; Mercadona,
  Carrefour o DIA quedan fuera y nunca se sobrescriben.
- Revisión determinista de 20 pares con nombres del catálogo real: 0 coincidencias absurdas `HIGH`.
  La lista real actual tiene cinco pendientes y, dado el catálogo vigente, cero matches seguros:
  Pan mantiene Mercadona y no hay productos actuales de leche, Fanta o ketchup.

- Import automático exclusivo de Lidl mediante dos triggers Cloudflare Cron (`0 3 * * *` y
  `0 4 * * *`). El handler calcula la hora real en `Europe/Madrid`: ejecuta sólo el trigger que
  corresponde a las 05:00 locales y registra el otro como `SKIPPED_TIME` sin crear `import_run`.
- El scheduled reutiliza directamente `SupermarketImportService`; no llama al endpoint HTTP ni
  necesita `IMPORT_ADMIN_KEY`. Los imports manuales siguen protegidos por ese secret.
- Lock D1 por proveedor: un `RUNNING` Lidl de menos de 15 minutos produce
  `SKIPPED_ALREADY_RUNNING`; uno más antiguo se cierra como `FAILED/IMPORT_STALE` antes de permitir
  un nuevo intento.
- Productos y tiendas se validan y preparan antes de persistir. Cero productos produce
  `LIDL_NO_VALID_PRODUCT` y una caída extrema frente al último `SUCCESS` produce
  `LIDL_SUSPICIOUS_PRODUCT_DROP`; ambos conservan el último dataset válido.
- La fecha mostrada como «Última actualización» procede del `finished_at` del último import Lidl
  `SUCCESS`, no del último intento fallido ni de una oferta individual.
- Prueba controlada del scheduled con Wrangler, hora CEST inyectada y proveedor Lidl real:
  `SUCCESS`, 53 productos, 53 precios, 84 ofertas, 42 Lidl Plus y 0 rechazados sobre D1 de pruebas;
  el segundo trigger hizo `SKIPPED_TIME` y quedó un único `import_run`.

- Mutaciones de lista optimistas: altas, ediciones, borrados y checked/un-checked se reflejan en la
  interfaz antes de recibir la respuesta remota, conservando rollback ante rechazo y cola offline
  por estado final deseado.
- Rutas D1 de toggle y borrado consolidadas en una consulta con `RETURNING`; altas y ediciones
  devuelven la fila desde su escritura y evitan lecturas completas/redundantes.
- El mantenimiento de `devices.last_seen_at` está limitado a una vez cada cinco minutos y se
  ejecuta fuera de la respuesta cuando existe `ExecutionContext`.
- Benchmark aislado con Worker + D1 local reales: altas de 25–48 ms, toggles de 20–23 ms y lectura
  del ciclo de 15 ms, sin modificar la lista local del propietario.

- `LidlProvider` real separado del fixture de UI y conectado al importador común y al endpoint
  protegido `POST /api/admin/imports/lidl`.
- Discovery dinámico desde la portada oficial de campañas actuales, próximas y frescas relevantes;
  el 29 de agosto de 2026 publicó una campaña actual y una próxima. Las URLs fechadas no se guardan
  como configuración.
- Tienda oficial confirmada en C. Torre San Francisco 2A, 06300 Zafra; slug canónico usado como ID
  público porque la página no publica un número de tienda.
- Fetch desde el runtime Cloudflare confirmado para portada, campaña vigente, próxima y frescos:
  HTTP 200, HTML, sin redirects y respuestas entre 385 KiB y 1,50 MiB. Allowlist, timeout de 9 s,
  máximo 2 MiB, un reintento y redirects revalidados.
- Parser de `data-grid-data` con selección explícita de la región Badajoz publicada por Lidl,
  precios normales/promocionales/Lidl Plus simultáneos, envase, vigencia Madrid, canal y categoría
  comercial. No calcula €/kg o €/l a partir del envase.
- Dos imports reales locales limpios: ambos `SUCCESS`, 54 productos, 54 precios, 86 ofertas vistas,
  43 Lidl Plus y 0 rechazados. Tras repetir permanecen 54 productos, 54 snapshots y 86 ofertas.
- Dos imports manuales en D1 de producción el 29 de agosto de 2026: ambos `SUCCESS`, 53 productos,
  53 precios, 84 ofertas vistas, 42 Lidl Plus y 0 rechazados. D1 permaneció en 53/53/84 tras la
  segunda pasada, con 0 duplicados y validación oficial 10/10.
- En producción hay 83 filas de oferta vigentes para 45 productos y 1 oferta futura; la UI agrupa
  precio regular, general y Lidl Plus por producto, y separa «Próximamente».
- `SUPERMARKET_FEATURE_ENABLED=true`; la lectura real de ofertas continúa separada del import
  automático y sólo Lidl está autorizado en `scheduled()`.
- Cuatro fixtures de campaña mínimos añadidos (índice, vigente, próxima y malformado); se conservan
  todos los fixtures anteriores y el demo visible continúa aislado.
- El import, el lock y la automatización Lidl no requirieron una migración específica; la posterior
  `0007` pertenece únicamente al aprendizaje de matches familiares.

- `DiaProvider` real separado en discovery, fetch, parse, normalize, validación y persistencia.
- Discovery estable de `/ofertas` y del localizador oficial de Zafra, sin URLs de campaña fechadas.
- Tiendas públicas confirmadas: 454, 17052 y 17583; sin coordenadas inventadas.
- Parser del `vike_pageContext` público para precio, precio unitario, marca, categoría comercial,
  Club DIA, porcentaje y segunda unidad; scope del catálogo `ONLINE`.
- Migración local `0006_nullable_offer_validity.sql` para no inventar fechas ausentes.
- Endpoint protegido `POST /api/admin/imports/dia`; feature flag y cron siguen desactivados.
- Siete fixtures DIA mínimos tomados de páginas públicas y validación manual 10/10 de nombres,
  precios y precios unitarios contra la web oficial.
- Import determinista con fixtures reales: 10 productos, 10 precios, 3 ofertas y 4
  ámbitos/tiendas; dos pasadas conservan 10 productos, 10 snapshots y 3 ofertas.
- Import remoto local: `FAILED`, cero productos, porque el runtime Cloudflare recibe una redirección
  oficial a `/error` tanto desde `/` como desde `/ofertas`. No se intentó evasión.

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

- 39 pruebas Angular, incluidas clasificación, emojis, accesibilidad, orden, caché offline,
  respuesta optimista, rollback, matching y estados/carga/error de Lidl Plus.
- 173 pruebas Worker/D1, incluidas lista, WebSocket, parsers Carrefour/DIA/Lidl, seguridad, import,
  idempotencia, Cron, matching, cantidades, precio efectivo, aislamiento household y cashback; 212
  pruebas en total.
- Aprendizaje entre ciclos, corrección, descarte, catálogo desaparecido, dos hogares aislados,
  supermercado `ANY`/LIDL/otro, oferta general + Lidl Plus y endpoint sin autenticar cubiertos.
- Revisión de falsos positivos con 20 pares del catálogo real: 20/20 correctos y ningún `HIGH`
  absurdo.
- Migraciones `0001`–`0009` aplicadas y comprobadas en D1 local.
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
- Optimización de mutaciones desplegada el 29 de agosto de 2026 en la versión
  `160c5769-bc85-4fbe-a7ae-31b060043ca6`; bundle `main-QG2DZH6I.js`.
- Smoke posterior a la optimización: shell y `/pair` `200`, salud `200`, API desconocida `404` y
  ruta privada sin token `401`. `SUPERMARKET_FEATURE_ENABLED=true` y `crons: []` se conservaron.
- Automatización diaria Lidl desplegada el 29 de agosto de 2026 en la versión
  `2d8ddce1-3d35-4a7a-b7bd-009ec85a0a9c`. Cloudflare confirmó los triggers `0 3 * * *` y
  `0 4 * * *`; `SUPERMARKET_FEATURE_ENABLED=true` y no se añadió ninguna migración.
- Matching Lidl desplegado el 30 de agosto de 2026 en la versión
  `db98cb3b-2491-48d6-9e81-96c223f5eb20`. `0007_household_product_matches.sql` quedó aplicada
  remotamente sin migraciones pendientes. Shell y `/pair` responden `200`, salud `200`, API
  desconocida JSON `404`, matching/ofertas sin token `401` y `/ws` sin upgrade `426`; manifest y
  service worker responden `200`.
- El bundle publicado contiene «Ofertas de tu lista» y «Revisar productos relacionados».
  `SUPERMARKET_FEATURE_ENABLED=true`; Cloudflare conserva exactamente `0 3 * * *` y `0 4 * * *`.
- Smoke D1 posterior: 1 hogar, 2 dispositivos, 1 ciclo activo, 5 items, 5 preferencias y 53
  productos Lidl, idénticos al checkpoint previo. Los cinco items están pendientes; el catálogo
  actual produce 0 matches/0 con oferta/5 unmatched: sólo existe `Pan bocadillo`, pero Pan conserva
  Mercadona, y `empanada`/`pañuelos` no coinciden por substring.
- Matching de cantidades y envases desplegado el 30 de agosto de 2026 en la versión
  `c0392240-a475-43cb-9389-ebe279e54069`; bundle `main-NIQWXEKJ.js`. La migración aditiva
  `0008_package_descriptions.sql` quedó aplicada local y remotamente, sin migraciones pendientes.
  Los 53 productos Lidl remotos conservan una descripción de envase tras el backfill; el texto
  original exacto, incluido `Aprox.`, se renovará con los imports posteriores.
- Smoke posterior: shell y `/pair` `200`, salud `200`, API desconocida JSON `404`, ofertas y
  matching sin token `401`, `/ws` sin upgrade `426`, manifest y service worker `200`. Los conteos
  familiares permanecieron en 1 hogar, 2 dispositivos, 1 ciclo activo, 5 items y 5 preferencias;
  el catálogo permaneció en 53 productos y 84 ofertas.
- El primer disparo natural de las 05:00 de Madrid terminó `SUCCESS` el 30 de agosto de 2026 a las
  `03:01:16.757Z`: 53 productos, 53 precios, 84 ofertas y ningún error. Cloudflare conserva
  exactamente los Cron `0 3 * * *` y `0 4 * * *`; no se modificó su programación.
- Preferencias familiares Lidl Plus desplegadas el 30 de agosto de 2026 en la versión
  `6db16841-5748-4b31-8f71-7b32f37cd32f`; bundle `main-6R3YRTJV.js` y estilos
  `styles-PPVRGUK2.css`. `0009_household_loyalty_programs.sql` quedó aplicada local y remotamente,
  sin pendientes y con cero filas iniciales: el hogar comienza en `UNKNOWN`/«Sin configurar».
- Smoke posterior: shell y `/pair` `200`, salud `200`, API desconocida JSON `404`, settings,
  ofertas y matching sin token `401`, `/ws` sin upgrade `426`, manifest y service worker `200`.
  El bundle contiene Lidl Plus, «Sin configurar», `settings/loyalty-programs` y «Tu precio».
- Los conteos posteriores permanecen en 1 hogar, 2 dispositivos, 1 ciclo activo, 5 items, 5
  preferencias, 53 productos Lidl y 84 ofertas. El último Cron sigue `SUCCESS` con 53 productos,
  53 precios, 84 ofertas y sin error; los triggers no cambiaron.
- Smoke posterior al Cron: shell y `/pair` `200`, salud `200`, API desconocida `404`, ofertas sin
  token `401` y `/ws` sin upgrade `426`. Los conteos familiares permanecieron en 1 hogar, 2
  dispositivos, 1 ciclo activo, 5 items y 5 preferencias. El catálogo remoto siguió en 53
  productos, 53 precios, 84 ofertas (42 Lidl Plus), 83 vigentes y 1 futura antes del primer disparo
  natural.
- Worker, Angular Static Assets, D1 y Durable Object comparten despliegue y origen.
- Preview URLs deshabilitadas explícitamente.
- Smoke tests: shell, manifest, service worker, `/pair` y salud responden `200`; API privada sin
  token y upgrade WebSocket sin credencial responden `401`; `/ws` sin upgrade responde `426`.
- Migraciones remotas `0001`–`0009` aplicadas; no quedan migraciones pendientes.
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
- Import DIA en producción: no ejecutado. Hace falta un feed oficial o acceso autorizado que
  responda de forma estable desde Cloudflare; los fixtures no se consideran import remoto.
- Comparador `¿Dónde sale más barato?`, hasta disponer de datos equivalentes y completos.

### Acción manual

No se requiere ninguna acción de infraestructura. Conviene abrir la aplicación en ambos móviles y
confirmar visualmente el emoji, el tachado y la actualización en tiempo real; `CARRY_PENDING` no se
ejecutó sobre la lista personal y queda cubierto por las pruebas automatizadas.

### Auditoría de rendimiento y categorías de ofertas — 30 de agosto de 2026

La regresión no estaba dentro del CRUD: `/api/offers` volvía a leer el ciclo y hacía matching de
cada oferta, mientras Angular mantenía en vuelo `/api/offers` y `/api/offers/for-list` después de
regresar a Lista. En Wrangler local esas consultas competían por D1/workerd: el log observado pasó
de POST de 2–5 s a PATCH de hasta 19,9 s bajo acumulación. El autocomplete también generaba una
cola de búsquedas antes del debounce/coalescing.

Se separaron `ShoppingStore` y `OffersStore`; salir de Ofertas aborta I/O, catálogo se cachea cinco
minutos y matching sólo se invalida por versión de lista. `/api/offers` ya no consulta el ciclo ni
ejecuta matching. Alta, edición, toggle y borrado tienen feedback optimista/rollback. La búsqueda se
debouncea 250 ms, coalesce a una petición en vuelo y los hábitos se refrescan diferidos. En pruebas
reales sin contención los POST observados bajaron a 143–191 ms; la respuesta visual es inmediata.

La migración aditiva `0010_offer_browse_categories_and_query_indexes.sql` y
`OfferBrowseCategory` están validadas en D1 local. El build inicial es 389,12 kB raw/100,86 kB
transferido frente a 384,75 kB/99,72 kB anterior; no existe chunk lazy de Ofertas. El incremento de
1,14 kB transferido corresponde a taxonomía, estado separado, cancelación y chips. Una prueba de
integración inserta 1.000 ofertas y confirma que dos toggles siguen usando únicamente autenticación
y el `UPDATE ... RETURNING` de lista.

La migración 0010 se aplicó remotamente sin pendientes y preservó exactamente 1 hogar, 2
dispositivos, 1 ciclo activo, 5 items, 5 preferencias, 53 productos Lidl y 84 ofertas. La versión
`1e4b7403-95f4-4865-9fbe-51043809528d` publicó el bundle `main-STK7HXTJ.js` manteniendo
`SUPERMARKET_FEATURE_ENABLED=true` y los Cron `0 3 * * *`/`0 4 * * *`. Smoke público: shell,
`/pair`, manifest, service worker y salud `200`; API desconocida JSON `404`; Ofertas/matching sin
token `401`; `/ws` sin upgrade `426`. El smoke CRUD autenticado y sincronización visual entre los
dos móviles requiere al propietario porque los device tokens no se leen ni se registran.

Tras el backfill remoto y antes del siguiente Cron, las tarjetas vigentes son: `OTHER` 24, `FRESH`
11, `FOOD` 5, `PERSONAL_CARE` 3, `CLEANING` 3 y `DRINKS` 1. El siguiente import programado
reclasificará mediante metadata actual y podrá incorporar las campañas de Jardín; no se lanzó un
import remoto manual en esta auditoría.
