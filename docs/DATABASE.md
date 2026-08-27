# Base de datos D1

Las migraciones son `0001_initial_schema.sql` y `0002_realtime_revisions.sql`. Ambas han sido
validadas con el runtime de pruebas oficial de Workers y con D1 local.

## Tablas

- `households`: hogar privado.
- `app_state`: singleton que impide repetir o apropiarse del bootstrap.
- `devices`: dispositivos autorizados y hashes SHA-256; nunca tokens en claro.
- `shopping_cycles`: historial `ACTIVE`, `COMPLETED` y `CLEARED`.
- `shopping_items`: productos ordenados dentro de cada ciclo.
- `supermarkets`: Lidl, Mercadona, Carrefour, DIA y Da igual.
- `product_preferences`: últimos valores y frecuencia por nombre normalizado/hogar.
- `pairing_codes`: hashes de códigos temporales, expiración y marca de uso.
- `household_revisions`: secuencia creciente de eventos de sincronización por hogar.

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

El seed `database/seeds/0001_supermarkets.sql` es idempotente. No se han creado ni migrado recursos
remotos y el `database_id` de producción continúa siendo un placeholder explícito.
