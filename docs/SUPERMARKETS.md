# Supermercados y ofertas

## Alcance de esta fase

El módulo está preparado para Lidl, Mercadona, Carrefour y DIA con foco en Zafra (06300), pero no
extrae datos reales. La pestaña `Ofertas` usa ocho fixtures marcados en API y UI como demostración.
Sus precios no deben interpretarse como precios comerciales vigentes.

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

- Fuente: [tiendas DIA de Zafra](https://www.dia.es/tiendas/buscador-tiendas/badajoz/zafra),
  [supermercado online](https://www.dia.es/) y [aviso legal](https://www.dia.es/l/aviso-legal).
- Método visible: páginas públicas de producto/precio y folletos por tienda. El localizador muestra
  tres establecimientos en Zafra y la vigencia del folleto aplicable.
- Ámbito: el surtido online se adapta al código postal; folleto y oferta pueden depender de tienda,
  Club DIA o canal online.
- Frecuencia esperable: semanal para folletos y potencialmente más frecuente para precio online.
- Estabilidad: media; las fichas son estructuradas, pero navegación, filtros y surtido cambian con
  código postal.
- Restricciones: el aviso legal concede uso privado del portal y reserva derechos sobre contenidos.
  `robots.txt` bloquea rutas de ofertas, búsqueda, filtros, analítica y `/products/`; no se crearán
  llamadas automatizadas a esas rutas sin autorización expresa o un feed oficial acordado.
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
