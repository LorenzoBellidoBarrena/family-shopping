# Base de datos D1

Las migraciones son `0001_initial_schema.sql`, `0002_realtime_revisions.sql`,
`0003_supermarket_catalog.sql`, `0004_product_categories.sql`,
`0005_carrefour_import_foundation.sql`, `0006_nullable_offer_validity.sql`,
`0007_household_product_matches.sql` y `0008_package_descriptions.sql`. Se validan con el runtime
de pruebas oficial de Workers y D1 local.

## Tablas

- `households`: hogar privado.
- `app_state`: singleton que impide repetir o apropiarse del bootstrap.
- `devices`: dispositivos autorizados y hashes SHA-256; nunca tokens en claro.
- `shopping_cycles`: historial `ACTIVE`, `COMPLETED` y `CLEARED`.
- `shopping_items`: productos ordenados dentro de cada ciclo, con categoría visual estable.
- `supermarkets`: Lidl, Mercadona, Carrefour, DIA y Da igual.
- `product_preferences`: últimos valores, categoría aprendida y frecuencia por nombre
  normalizado/hogar.
- `pairing_codes`: hashes de códigos temporales, expiración y marca de uso.
- `household_revisions`: secuencia creciente de eventos de sincronización por hogar.
- `stores`: establecimientos o ámbitos comerciales, con geolocalización opcional.
- `external_products`: catálogo publicado, EAN opcional, formato original y última observación.
- `product_aliases`: equivalencias léxicas globales y matches Lidl aprendidos aislados por hogar.
- `store_products`: relación de publicación producto/tienda; no representa stock.
- `product_prices`: histórico de precios en céntimos enteros.
- `offers`: promociones, vigencia, fuente y requisito de tarjeta en céntimos enteros.
- `import_runs`: ejecución y métricas acotadas del proveedor, sin respuestas ni stack traces.

Un índice único parcial sobre `shopping_cycles(household_id) WHERE status = 'ACTIVE'` garantiza en
la propia base que cada hogar tenga como máximo un ciclo activo.

## Cantidades

Las cantidades se reciben y devuelven como texto decimal, por ejemplo `"1.5"`. D1 guarda
`quantity_milli` como entero (`1500`), con un máximo de tres decimales. Así no se usan floats ni se
introducen errores binarios de precisión.

## Normalización y preferencias

Los nombres se normalizan quitando diacríticos, pasando a minúsculas y unificando separadores. La
clave única `(household_id, normalized_name)` permite recordar supermercado, unidad y cantidad. La
frecuencia aumenta al añadir el producto, no al editarlo.

`0004_product_categories.sql` añade `shopping_items.category` como `NOT NULL DEFAULT 'OTHER'` y
realiza así un backfill seguro de todos los items existentes sin reglas SQL lingüísticas. Añade
también `product_preferences.category` nullable: `NULL` significa que una preferencia histórica
aún no tiene una corrección aprendida y permite recurrir al clasificador local. Ambos campos tienen
un `CHECK` con los códigos estables de `ProductCategory`.

## Importación Carrefour

`0005` extiende las tablas de Prompt 6 sin duplicarlas. `external_products.category` conserva la
taxonomía comercial y `visual_category` guarda el mapping visual. Los precios incorporan unidad,
canal y scope geográfico; las ofertas incorporan tipo estructurado, porcentaje, cantidades de
multicompra, canal y fidelización. `import_runs` usa `RUNNING`, `SUCCESS`, `PARTIAL` y `FAILED`.

El canal público observado es online, por lo que se persiste bajo el ámbito lógico
`carrefour-online-es`, nunca como stock ni como precio de Carrefour Zafra. El histórico añade un
snapshot sólo cuando cambia precio o precio unitario. Las ofertas se actualizan por su clave natural
y las expiradas se conservan, pero la consulta activa aplica ambos límites de vigencia.

## Importación DIA

`0006` reconstruye de forma conservadora sólo `offers`, copiando todos los registros existentes,
para permitir `valid_from` y `valid_until` nulos. DIA no publica vigencia individual en todos los
productos de su página de ofertas y el importador no inventa fechas. La consulta activa trata cada
límite nulo como abierto. La idempotencia compara ambos valores con `IS`, por lo que imports sin
fechas tampoco duplican ofertas.

Las tres tiendas de Zafra usan sus IDs públicos DIA. El catálogo online se persiste, cuando la fuente
responde, bajo `dia-online-es`; una publicación significa catálogo, nunca stock. No existen tablas ni
columnas específicas de DIA.

## Importación Lidl

Lidl reutiliza sin cambios `stores`, `external_products`, `store_products`, `product_prices`,
`offers` e `import_runs`; su importación no requirió un esquema específico. El localizador oficial permite
guardar la tienda de Zafra mediante el slug canónico público porque la página no expone un número de
tienda. Las coordenadas sólo se guardan porque aparecen explícitamente en su JSON-LD.

El catálogo lógico `campaign-region-badajoz` representa fichas de campaña cuyo `regionsV2` enlaza
explícitamente Badajoz con el bloque de precio usado. Su scope es `REGIONAL`, nunca stock ni precio
confirmado de la tienda de Zafra. Un producto puede tener simultáneamente una oferta general y otra
`LOYALTY_PRICE/LIDL_PLUS`; la tabla `offers` existente ya admite ambas mediante filas distintas, por
lo que no se creó una migración de proveedor. El histórico de `product_prices` sigue añadiendo snapshot sólo
cuando cambia el precio.

## Matching familiar con catálogo

`0007_household_product_matches.sql` amplía de forma conservadora `product_aliases`; no crea una
tabla paralela. Conserva y copia los aliases globales existentes, y añade `household_id`,
`supermarket_id`, `external_product_id`, `match_status` (`CONFIRMED` o `DISMISSED`) y
`updated_at`. La clave parcial `(household_id, normalized_alias, supermarket_id)` impide mezclar
preferencias entre hogares. El producto externo usa `ON DELETE SET NULL`: si desaparece del
catálogo no se rompe la preferencia ni el ciclo familiar y el matcher puede volver a generar
candidatos.

La relación se guarda por hogar y nombre normalizado, no por `shopping_item_id`. Por ello sobrevive
a una lista nueva, a Habituales y a `CARRY_PENDING`. Los aliases léxicos globales mantienen su
índice único parcial independiente y siguen sin pertenecer a un hogar.

`0008_package_descriptions.sql` añade `external_products.package_description` para conservar el
texto original publicado (`3x65 g`, `Aprox. 400 g`, `A granel`). Hace un backfill seguro desde
`package_quantity/package_unit`; los imports Lidl posteriores guardan el texto exacto. Los cálculos
de envases, exceso y coste siguen siendo derivados en runtime y no crean columnas.

## Atomicidad

- Bootstrap: household, singleton, primer device y primer ciclo en un lote.
- Pairing: inserción condicionada del device y consumo del código en un lote.
- Añadir/editar: item y preferencia en un lote.
- Completar/vaciar: cierre, ciclo nuevo y posibles pendientes copiados en un lote.

La revisión se incrementa después de que la mutación de dominio haya quedado confirmada. Sirve para
ordenar y deduplicar avisos; nunca sustituye la lectura canónica del ciclo activo.

## Desarrollo

```bash
npm run db:setup:local
```

El seed `database/seeds/0001_supermarkets.sql` es idempotente. `0007` añade exclusivamente la
persistencia de matching familiar y `0008` conserva la descripción del envase; ninguna altera
items, ciclos, precios u ofertas. Los fixtures viven sólo en código/pruebas y nunca se cargan
mediante una migración.

Las migraciones `0001`–`0008` están aplicadas tanto en D1 local como en
`family-shopping-db` remota; no quedan migraciones pendientes al cierre del 30 de agosto de 2026.
