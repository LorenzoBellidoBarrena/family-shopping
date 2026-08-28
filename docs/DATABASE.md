# Base de datos D1

Las migraciones son `0001_initial_schema.sql`, `0002_realtime_revisions.sql`,
`0003_supermarket_catalog.sql`, `0004_product_categories.sql` y
`0005_carrefour_import_foundation.sql`. Se validan con el runtime de pruebas oficial de Workers y
D1 local.

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
- `external_products`: catálogo publicado por cadena, EAN opcional y última observación.
- `product_aliases`: equivalencias normalizadas revisables.
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

El seed `database/seeds/0001_supermarkets.sql` es idempotente. La migración `0003` está aplicada en
D1 local y remota; no contiene fixtures ni datos comerciales. `0004` está aplicada local y
remotamente. `0005` se valida primero en D1 local antes de cualquier despliegue. Los fixtures viven
sólo en código/pruebas y nunca se cargan mediante una migración.
