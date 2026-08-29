# Supermercados y ofertas

## Alcance de esta fase

El módulo está preparado para Lidl, Mercadona, Carrefour y DIA con foco en Zafra (06300). Los
parsers de Carrefour y DIA usan fixtures reales mínimos, pero ninguna fuente remota es estable desde
Cloudflare y no se ha ejecutado ningún import en producción. La pestaña `Ofertas` continúa usando
fixtures marcados como demostración; no deben interpretarse como precios vigentes.

La lista familiar no depende de este módulo. Cada proveedor implementa `SupermarketProvider` y se
consulta con `Promise.allSettled`: si una cadena falla, las demás siguen respondiendo y la API marca
el resultado como parcial.

## Modelo de datos

- `stores`: tienda física o ámbito comercial; admite identificador externo y coordenadas.
- `external_products`: producto publicado por una cadena, con EAN opcional y fecha de última vista.
- `store_products`: publicación producto/tienda. Utiliza `catalog_status`; nunca representa stock.
- `product_prices`: observaciones históricas en céntimos enteros.
- `offers`: precio promocional, vigencia, fuente y requisito de tarjeta, también en céntimos.
- `product_aliases`: equivalencias revisables para relacionar nombres familiares y catálogo.

`store_products.catalog_status = PUBLISHED` significa únicamente «producto publicado» o
«disponible en catálogo». No confirma existencias en tienda.

La categoría visual de la lista (`ProductCategory`, por ejemplo `DAIRY → 🥛`) no sustituye estas
categorías comerciales. `external_products.category` y `product_aliases.category` siguen siendo
campos libres del proveedor y podrán representar niveles más concretos como leche semidesnatada.
Cuando existan catálogos reales se definirá un mapping explícito hacia la categoría visual; en esta
fase ambas taxonomías permanecen separadas y el algoritmo de matching no se modifica.

## Normalización y relación con la lista

La primera versión normaliza mayúsculas, diacríticos, puntuación y espacios; elimina términos de
envase/unidad y aplica alias sencillos (`papas → patata`, `bananas → plátano`, plurales frecuentes).
Una oferta se relaciona cuando todos los términos relevantes de un elemento de la lista aparecen
en el producto publicado. La arquitectura permite incorporar después:

1. aliases persistidos y revisados;
2. categoría compatible;
3. marca y cantidad de envase;
4. EAN cuando exista;
5. puntuación explicable, sin IA externa de pago.

No se implementa todavía `¿Dónde sale más barato?`: comparar sólo precios observados sin igualar
envases, vigencia y ámbito de tienda produciría conclusiones incorrectas.

## Evaluación de fuentes oficiales (28 de agosto de 2026)

### Lidl

- Fuente: [folletos semanales oficiales](https://www.lidl.es/c/descubre-nuevas-ofertas-cada-semana-folletos-lidl/s10087402)
  y [buscador oficial de tiendas](https://tiendas.lidl.es/).
- Método visible: página pública dinámica y folletos; requiere seleccionar tienda para ofertas
  regionales. La propia página indica campañas de alimentación y bazar y dos días de publicidad.
- Ámbito: regional/tienda. Existe tienda en Zafra, pero una publicación no garantiza existencias.
- Frecuencia esperable: al menos semanal, con cambios de campaña lunes/viernes.
- Estabilidad: media-baja para extracción; el contenido y enlaces de folletos son editoriales.
- Restricciones: `robots.txt` bloquea APIs de usuario, búsqueda y varios parámetros de catálogo.
  Lidl Plus exige cuenta y contiene ofertas personalizadas; queda fuera del alcance.
- Limitación: el comercio electrónico general mezcla alimentación en tienda con otras categorías
  online, por lo que no debe asumirse que todo producto corresponde a la tienda de Zafra.

### DIA

- Fuente: [tiendas DIA de Zafra](https://www.dia.es/tiendas/buscador-tiendas/badajoz/zafra/06300),
  [ofertas DIA](https://www.dia.es/ofertas), [supermercado online](https://www.dia.es/) y
  [`robots.txt`](https://www.dia.es/robots.txt).
- Método visible: HTML público con `vike_pageContext` JSON embebido. El localizador confirma CR
  Santos de Maimona (454), AV Estación/PZ América (17052) y CL López Asme (17583), todas en 06300.
- Ámbito: el surtido online se adapta al código postal; folleto y oferta pueden depender de tienda,
  Club DIA o canal online.
- Frecuencia esperable: semanal para folletos y potencialmente más frecuente para precio online.
- Estabilidad: media; las fichas son estructuradas, pero navegación, filtros y surtido cambian con
  código postal.
- Restricciones: `robots.txt` permite `/ofertas`, pero bloquea subrutas paginadas de ofertas,
  búsqueda, filtros, analítica y `/products/`; el provider no consulta ninguna ruta bloqueada.
  Desde el runtime Cloudflare, `/` y `/ofertas` redirigen a `/error`. Se detuvo ese camino sin
  cambiar identidad, cookies, sesiones, proxies ni controles anti-bot.
- Limitación: «agotado» online y publicación en catálogo no demuestran stock en la tienda física.

### Carrefour

- Fuente: [Carrefour Zafra](https://www.carrefour.es/tiendas-carrefour/hipermercados/carrefour/zafra.aspx),
  [supermercado y folletos](https://www.carrefour.es/supermercado/) y
  [condiciones de medios digitales](https://www.carrefour.es/terminos-y-condiciones-uso-medios-digitales/mas-info/).
- Método visible: tienda oficial con dirección/servicios, páginas públicas de catálogo y campañas.
- Ámbito: hipermercado Zafra y canal online; promociones pueden ser nacionales, locales, exclusivas
  online o ligadas a El Club Carrefour.
- Frecuencia esperable: campañas semanales o de varios días; revisar vigencia de cada promoción.
- Estabilidad: media; dispone de sitemaps oficiales de alimentación, aunque las rutas promocionales
  cambian por campaña.
- Restricciones: las condiciones regulan navegación y reutilización. `robots.txt` bloquea AJAX,
  carrito, cuenta, filtros, búsquedas y endpoints internos; sólo serían candidatas páginas públicas
  permitidas o un acuerdo/feed oficial.
- Limitación: precio online, cupón y precio de hipermercado pueden no coincidir.

### Mercadona

- Fuente: [tienda oficial](https://tienda.mercadona.es/),
  [ayuda de compra online](https://ayuda.tienda.mercadona.es/hc/es/categories/360000066951-Preguntas-Frecuentes)
  y [listado oficial que incluye Zafra](https://info.mercadona.es/document/es/listado-tiendas-listo-para-comer-0.pdf).
- Método visible: aplicación web dinámica con fichas públicas de productos; la cobertura y el
  surtido dependen de la dirección/código postal.
- Ámbito: tienda online/área de reparto, no necesariamente la tienda física de Zafra.
- Frecuencia esperable: precios de catálogo sin calendario público fijo. Mercadona no sigue el
  mismo modelo de folletos promocionales de las otras cadenas.
- Estabilidad: baja para extracción no acordada por depender de JavaScript y contexto geográfico.
- Restricciones: no se utilizarán endpoints privados descubiertos en la aplicación, sesiones,
  credenciales ni mecanismos destinados al checkout. Antes de automatizar se necesita confirmar
  por escrito el uso permitido y disponer preferentemente de un feed oficial.
- Limitación: en frescos el precio por unidad puede ser estimado y el importe final depende del peso
  preparado, según la ayuda oficial.

## Recomendación

El primer proveedor real recomendado es **DIA, únicamente después de obtener permiso o acceso a un
feed oficial**. Es el mejor piloto funcional para Zafra porque el sitio oficial identifica tiendas
concretas, vigencia de folletos y fichas públicas con precio/unidad. Sin permiso/feed, la siguiente
acción no debe ser programar scraping: debe ser contactar con DIA y documentar el canal autorizado.

Carrefour sería la segunda opción por su tienda de Zafra y sitemaps públicos. Lidl requiere resolver
la selección de tienda y el formato cambiante de folletos. Mercadona se reservaría para catálogo y
precios, no para ofertas, y sólo con acceso autorizado que preserve el contexto geográfico.

## Reglas para un proveedor real futuro

- Identificación clara del agente y frecuencia conservadora.
- Respetar términos, `robots.txt`, límites y solicitudes de retirada.
- No evadir CAPTCHA, autenticación, rate limits ni protecciones anti-bot.
- No usar credenciales de clientes ni APIs privadas.
- Guardar fuente, instante observado, tienda/ámbito y vigencia en cada dato.
- Invalidar datos caducados y mostrar siempre «disponibilidad no confirmada».
- Detener sólo el proveedor afectado ante cambios; la lista familiar y las otras cadenas continúan.

## Fundación real de Carrefour

La implementación utiliza como punto de discovery el
[sitemap oficial de alimentación](https://www.carrefour.es/crs/cdn-static/sitemap-food/index.xml),
publicado por el propio [`robots.txt`](https://www.carrefour.es/robots.txt). Sólo acepta HTTPS,
`www.carrefour.es`, rutas del sitemap de alimentación y fichas públicas `/supermercado/.../R-.../p`.
No usa AJAX, búsqueda, carrito, cuenta, cookies, tokens privados ni rutas desautorizadas.

`CarrefourProvider` separa `discover`, `fetch`, `parse` y `normalize`. El parser consume datos
estructurados `Product`/`Offer`, convierte coma decimal y precios unitarios a céntimos, reutiliza
`normalizeProductName` y mapea con prudencia a `ProductCategory`. Soporta precio directo, porcentaje,
3x2, segunda unidad, cashback, loyalty y precio especial. Cashback conserva como precio pagado hoy
el precio completo.

La [ficha pública de leche](https://www.carrefour.es/supermercado/leche-entera-pascual-brik-1-l/R-521006986/p)
muestra nombre, marca, precio, precio unitario y validez. La
[página oficial de Carrefour Zafra](https://www.carrefour.es/tiendas-carrefour/hipermercados/carrefour/zafra.aspx)
confirma dirección y menciona 3x2, segunda unidad, cashback y Club Carrefour, pero no demuestra que
los precios online pertenezcan a esa tienda. Por ello el scope persistido es `ONLINE`, no `STORE`.

Una petición conservadora al sitemap desde el entorno de desarrollo recibió el bloqueo de seguridad
de Carrefour. No se cambiaron user agents, cookies, proxies ni sesiones para sortearlo. Los fixtures
mínimos de `tests/fixtures/carrefour/` permiten validar el parser y el importador local, pero no se
ha realizado ni se afirma una descarga real estable. El siguiente paso legítimo es obtener permiso o
un feed oficial; hasta entonces el feature flag y el cron permanecen desactivados.

## Implementación y validación DIA

`DiaProvider` limita hosts y rutas oficiales, bloquea redirects arbitrarios, usa timeout de 9 s,
1 MiB máximo y un solo reintento. Discovery consulta rutas estables, no campañas fechadas. Separa
el parser de tiendas del parser de catálogo y reutiliza `external_products`, `product_prices`,
`offers`, `stores`, `store_products` e `import_runs`.

Los precios se convierten inmediatamente a céntimos enteros. `commercial_category` procede de la
ruta comercial y `visual_category` del clasificador compartido; no se mezclan taxonomías. En los
datos observados aparecen precios Club DIA, descuentos porcentuales y segunda unidad. Club se
persiste como `CLUB_DIA`. No se observó un 3x2 en las diez muestras y no se afirma lo contrario.

Los precios web se marcan `ONLINE`; las tres tiendas sólo se asocian a sus metadatos. No se atribuye
a Zafra un precio online y no se usa `units_in_stock`, aunque aparezca en el JSON, porque no
demuestra stock físico. Cuando DIA no da vigencia individual se conserva `NULL`.

Los fixtures `stores`, `standard-price`, `club-dia`, `second-unit`, `offers-page`, `weekly-offers` y
`malformed` contienen sólo fragmentos necesarios. Diez productos se contrastaron con la fuente el
28 de agosto: 10/10 nombres, precios y precios unitarios coincidieron. El import determinista sobre
D1 de pruebas produjo 10 productos, 10 precios, 3 ofertas y 4 stores/ámbitos; la segunda pasada no
duplicó filas. El import real desde Worker produjo `FAILED`, 0 productos, por redirect a `/error`.
Por ello el criterio global es **FAIL para automatización remota**, pese a que parser y persistencia
con fixtures sean correctos.

### Seguridad y operación

- `IMPORT_ADMIN_KEY` es independiente del device token y está configurado como secret en producción.
- `SUPERMARKET_FEATURE_ENABLED=true` activa sólo la lectura de ofertas reales persistidas.
- Máximo 20 fichas por petición administrativa, 8 segundos y 2 MiB por respuesta.
- Allowlist estricta evita SSRF y se vuelve a validar la URL tras redirects.
- Un producto inválido produce `PARTIAL`; discovery bloqueado produce `FAILED` sin stack trace.
- Precio histórico sólo se inserta cuando cambia; producto y oferta usan upsert idempotente.
- `scheduled()` está preparado, pero `crons: []`. Cloudflare Cron usa UTC; no se fija todavía una
  hora para evitar errores con el horario Europe/Madrid.

## Implementación y validación de campañas Lidl

`LidlProvider` descubre enlaces desde la [portada oficial](https://www.lidl.es/) y admite únicamente
rutas allowlisted de campañas semanales, próxima semana y frescos. El 29 de agosto de 2026 la portada
publicó una campaña vigente y una próxima; los identificadores se extrajeron dinámicamente. El visor
de folletos anterior se conserva sólo para metadata y ya no es la fuente de productos.

Las páginas de campaña contienen JSON público por ficha en `data-grid-data`. El parser selecciona el
bloque cuyo `regionsV2.regionName` normaliza a Badajoz (la fuente observada lo escribe «Bádajoz») y
usa su `regionPriceId`; por ello el scope es `REGIONAL`, no `STORE`. Conserva por separado precio
general, descuento general y precio `LOYALTY_PRICE/LIDL_PLUS`. Si la fuente no publica precio
unitario explícito se deja `NULL`: nunca se calcula a partir del envase. Las vigencias UTC se
convierten a fecha de `Europe/Madrid` y `endDateExclusive` se trata como límite exclusivo.

La [tienda oficial de Zafra](https://www.lidl.es/s/es-ES/tiendas/zafra/c-torre-san-francisco-2a/)
continúa persistida desde su JSON-LD mediante el slug público `zafra-c-torre-san-francisco-2a`.
Campaña regional y tienda física son registros distintos; publicación en catálogo no significa
stock ni demuestra que el precio sea exclusivo de ese local.

Desde el runtime local de Cloudflare, portada, campaña general, vigente, próxima y frescos
respondieron HTTP 200, `text/html`, sin redirects y entre 385 KiB y 1,50 MiB. Se mantiene timeout de
9 segundos, un reintento, máximo 2 MiB, allowlist y revalidación de redirects. No se usa OCR, PDF,
cookies, sesión, proxy ni bypass.

Fixtures reales mínimos añadidos en `tests/fixtures/lidl/campaigns`: `index-real.html`,
`current-real.html` y `next-real.html`; `malformed.html` es un límite sintético rotulado. Se
conservan los fixtures anteriores para regresión. Las muestras reales cubren descuento general y
Lidl Plus simultáneos, sólo Lidl Plus, multipack, envase, fechas, canal tienda y región.

Dos imports reales limpios sobre D1 local terminaron `SUCCESS`: 54 productos, 54 precios, 86 ofertas
vistas, 43 Lidl Plus y cero rechazados en cada run. Tras la segunda pasada D1 contiene exactamente
54 productos, 54 snapshots y 86 ofertas: no hay duplicados. Diez productos se contrastaron contra
el JSON estructurado oficial con coincidencia 10/10 en nombre, envase, precios, porcentajes, fechas,
canal y scope. No se ejecutó import remoto, no se desplegó, no se activó el feature flag ni el cron.

| Producto                      | App local                         | JSON oficial Lidl                                | Resultado |
| ----------------------------- | --------------------------------- | ------------------------------------------------ | --------- |
| Uva blanca sin semilla        | 2,35 €; Plus 1,89 €; 750 g        | 2,99→2,35 (-21%); Plus 1,89 (-36%); 750 g        | PASS      |
| Ciruela roja                  | 2,72 €; Plus 1,99 €; granel       | 3,45→2,72 (-21%); Plus 1,99 (-42%); granel       | PASS      |
| Burger de atún                | 2,95 €; Plus 2,44 €; 240 g        | 3,49→2,95 (-15%); Plus 2,44 (-30%); 240 g        | PASS      |
| Filetes de merluza argentina  | 6,74 €; Plus 5,99 €; 970 g        | 7,49→6,74 (-10%); Plus 5,99 (-20%); 970 g        | PASS      |
| Burger meat picada mixta      | 6,07 €; Plus 5,40 €; 1 kg         | 6,75→6,07 (-10%); Plus 5,40 (-20%); 1 kg         | PASS      |
| Solomillo de pollo            | 2,82 €; Plus 2,51 €; aprox. 400 g | 3,14→2,82 (-10%); Plus 2,51 (-20%); aprox. 400 g | PASS      |
| Mantequilla light             | 1,64 €; Plus 1,23 €; 250 g        | 2,05→1,64 (-20%); Plus 1,23 (-40%); 250 g        | PASS      |
| Atún claro en aceite de oliva | base 2,59 €; Plus 1,79 €; 3x65 g  | 2,59→1,79 Plus (-30%); 3x65 g                    | PASS      |
| Limón malla                   | 2,75 €; 1 kg; sin oferta          | 2,75 €; 1 kg; sin descuento publicado            | PASS      |
| Cebolla malla                 | 1,59 €; 1 kg; sin oferta          | 1,59 €; 1 kg; sin descuento publicado            | PASS      |

Las diez fichas publican región Badajoz, canal tienda y vigencia 24–30 de agosto cuando existe
promoción. El precio unitario queda `NULL` en estas muestras porque la ficha no lo aporta de forma
estructurada inequívoca.

El [`aviso legal`](https://www.lidl.es/c/aviso-legal/s10075786) sigue siendo una limitación
operativa: antes de automatizar o importar en producción conviene obtener autorización o confirmar
un canal oficial de reutilización. La implementación sólo guarda los campos mínimos necesarios y
no redistribuye páginas completas.

### Primera importación controlada en producción

El 29 de agosto de 2026 se aplicó remotamente `0006_nullable_offer_validity.sql` sin alterar datos
familiares. Dos imports manuales protegidos por `IMPORT_ADMIN_KEY` terminaron `SUCCESS` con métricas
idénticas: 53 productos, 53 precios, 84 ofertas vistas, 42 Lidl Plus y 0 rechazados. Tras ambos runs
D1 contiene 2 registros de ámbito (tienda Zafra y scope regional Badajoz), 53 productos, 53
snapshots y 84 ofertas; no existen duplicados.

La validación remota confirmó 10/10 fichas contra el JSON oficial. Hay 83 filas vigentes para 45
productos y una futura. `LidlD1OffersProvider` devuelve sólo datos persistidos no expirados, agrupa
oferta general y Lidl Plus y marca las fechas futuras como `upcoming`. El scope lógico se presenta
como Badajoz y nunca como establecimiento físico de Zafra. El modo real está activo mediante
`SUPERMARKET_FEATURE_ENABLED=true`; el import administrativo conserva su gate independiente por
secret y `crons: []` sigue desactivado.
