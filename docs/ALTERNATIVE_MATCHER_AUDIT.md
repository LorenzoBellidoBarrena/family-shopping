# Auditoría local de AlternativeMatcher

Fecha: 31 de agosto de 2026. Esta auditoría utiliza exclusivamente D1 local y no modifica
producción.

## Resultado

- Catálogo Lidl local: 98 productos reales importados.
- Productos revisados manualmente en la muestra: 50.
- Concepto explícito reconocido en el catálogo completo: 2.
- Concepto desconocido: 96.
- Ofertas vigentes en la fecha de auditoría: 4.
- Decisiones positivas/negativas revisadas en tests: 32 (16/16).
- Falsos positivos en las 16 decisiones negativas: 0.
- Escenarios de relación esperada revisados: 22.
- Escenarios no detectados antes: 8 (cuatro direcciones nuevas y cuatro variantes léxicas).
- Escenarios no detectados después: 0.

El catálogo local no contiene actualmente plátano, banana, mandarina ni clementina. Por ello la
semántica nueva se valida con fixtures sintéticos declarados y tests de integración D1; el catálogo
real se usa para confirmar que el diccionario ampliado no fuerza conceptos ni alternativas.

## Muestra de 50 productos Lidl

`EXPLICIT_TERM` significa que existe vocabulario inequívoco del concepto. `UNKNOWN` es deliberado:
compartir categoría no crea un concepto.

| Producto Lidl                              | Concepto        | Confianza / motivo               |
| ------------------------------------------ | --------------- | -------------------------------- |
| Abono azul universal                       | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Aceite de oliva virgen extra               | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Activia cremoso                            | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Alpro                                      | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Argus Cerveza suave                        | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Argus Shandy                               | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Baileys                                    | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| BARESA Aceitunas verdes rellenas de anchoa | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| BARESA Salsa de tomate con cebolla         | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Bublo premium                              | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Bulbos                                     | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Bulbos                                     | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Bulbos cambian color                       | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Burger de atún                             | UNKNOWN         | Excluido por derivado de pescado |
| Café natural (Café mezcla)                 | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Caffe Latte / Matcha Latte                 | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Cava brut                                  | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Cebolla 1 kg malla                         | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Celosía                                    | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Chef Select Croquetas de jamón             | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Chef Select Masa para empanada             | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| CIEN Champú frutal protección y brillo     | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| CIEN Pañuelos de papel aloe vera           | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| CIEN Sun Spray infantil FPS 50+            | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Ciruela roja                               | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Compresas Discreet Mini                    | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Crema corporal hidratante                  | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Crisantemo                                 | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| CROWNFIELD Copos de avena                  | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Dentífrico blanqueador                     | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Detergente                                 | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Detergente líquido                         | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| DOUSSY Perfumador floral para ropa         | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| DOUSSY Suavizante azul                     | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| DULANO Salchichas tipo Bockwurst           | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Dummymarke Brezo                           | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Dummymarke Bulbos de Narcisos              | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Dummymarke Bulbos de tulipanes             | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Fairy Todo en 1 lavavajillas               | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Fingers de pollo                           | CHICKEN_FINGERS | EXPLICIT_TERM                    |
| FLORALYS Mega rollo resistente             | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Fluido antimanchas                         | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Freeway Cola                               | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Friegasuelos concentrado                   | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Gamba cocida                               | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Garnier Serum antimanchas                  | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Gel de baño                                | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Higo                                       | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Hydration                                  | UNKNOWN         | NO_EXPLICIT_CONCEPT              |
| Johnson & Johnson Enjuague bucal           | UNKNOWN         | NO_EXPLICIT_CONCEPT              |

En los 48 productos restantes sólo `Realvalle Burger meat picada mixta` se reconoce como
`BURGER_MEAT`; los otros 47 permanecen `UNKNOWN`.

## Relaciones globales

Todas son direccionales y están configuradas explícitamente. En esta fase se añadieron únicamente
dos pares bidireccionales (cuatro direcciones).

| Origen                 | Destino                | Dirección | Tipo                   | Motivo                                |
| ---------------------- | ---------------------- | --------- | ---------------------- | ------------------------------------- |
| PLATANO                | BANANA                 | →         | CLOSE_SUBSTITUTE       | Frutas frescas próximas, no idénticas |
| BANANA                 | PLATANO                | →         | CLOSE_SUBSTITUTE       | Frutas frescas próximas, no idénticas |
| MANDARINA              | CLEMENTINA             | →         | CLOSE_SUBSTITUTE       | Cítricos frescos cotidianos próximos  |
| CLEMENTINA             | MANDARINA              | →         | CLOSE_SUBSTITUTE       | Cítricos frescos cotidianos próximos  |
| NUGGETS                | CHICKEN_FINGERS        | →         | PREPARATION_SUBSTITUTE | Preparados empanados de pollo         |
| CHICKEN_FINGERS        | NUGGETS                | →         | PREPARATION_SUBSTITUTE | Preparados empanados de pollo         |
| NUGGETS                | BREADED_CHICKEN_STRIPS | →         | PREPARATION_SUBSTITUTE | Preparados empanados de pollo         |
| BREADED_CHICKEN_STRIPS | NUGGETS                | →         | PREPARATION_SUBSTITUTE | Preparados empanados de pollo         |
| CHICKEN_FINGERS        | BREADED_CHICKEN_STRIPS | →         | PREPARATION_SUBSTITUTE | Preparados empanados de pollo         |
| BREADED_CHICKEN_STRIPS | CHICKEN_FINGERS        | →         | PREPARATION_SUBSTITUTE | Preparados empanados de pollo         |
| BURGER                 | BURGER_MEAT            | →         | VARIANT_SUBSTITUTE     | Formatos próximos de hamburguesa      |
| BURGER_MEAT            | BURGER                 | →         | VARIANT_SUBSTITUTE     | Formatos próximos de hamburguesa      |
| BURGER                 | MINI_BURGER            | →         | VARIANT_SUBSTITUTE     | Formatos próximos de hamburguesa      |
| MINI_BURGER            | BURGER                 | →         | VARIANT_SUBSTITUTE     | Formatos próximos de hamburguesa      |
| BURGER_MEAT            | MINI_BURGER            | →         | VARIANT_SUBSTITUTE     | Formatos próximos de hamburguesa      |
| MINI_BURGER            | BURGER_MEAT            | →         | VARIANT_SUBSTITUTE     | Formatos próximos de hamburguesa      |
| FROZEN_FRIES           | POTATO_WEDGES          | →         | VARIANT_SUBSTITUTE     | Guarniciones congeladas de patata     |
| POTATO_WEDGES          | FROZEN_FRIES           | →         | VARIANT_SUBSTITUTE     | Guarniciones congeladas de patata     |

No se eliminó ninguna relación previa. Se corrigió el alias léxico de identidad `bananas` para que
normalice a `banana`, no a `platano`; no se cambió ningún score ni threshold.

## Casos positivos revisados

| Lista                     | Producto                  | Resultado   | Motivo                                |
| ------------------------- | ------------------------- | ----------- | ------------------------------------- |
| Plátano                   | Plátano de Canarias       | MATCH       | Mismo término normalizado             |
| Plátano                   | Banana                    | ALTERNATIVE | PLATANO → BANANA                      |
| Plátanos                  | Banana granel             | ALTERNATIVE | Plural y relación explícita           |
| Platano                   | Bananas bio               | ALTERNATIVE | Acentos/plurales y relación explícita |
| Banana                    | Plátano de Canarias       | ALTERNATIVE | BANANA → PLATANO                      |
| Mandarina                 | Clementina malla          | ALTERNATIVE | MANDARINA → CLEMENTINA                |
| Clementinas               | Mandarina granel          | ALTERNATIVE | CLEMENTINA → MANDARINA                |
| Nuggets                   | Fingers de pollo          | ALTERNATIVE | Preparado próximo explícito           |
| Nuggets                   | Tiras de pollo empanadas  | ALTERNATIVE | Preparado próximo explícito           |
| Fingers de pollo          | Nuggets de pollo          | ALTERNATIVE | Preparado próximo explícito           |
| Tiras de pollo empanadas  | Fingers de pollo          | ALTERNATIVE | Preparado próximo explícito           |
| Hamburguesas              | Burger meat               | ALTERNATIVE | Variante explícita                    |
| Hamburguesas              | Mini burgers              | ALTERNATIVE | Variante explícita                    |
| Burger meat               | Hamburguesa de vacuno     | ALTERNATIVE | Variante explícita                    |
| Patatas fritas congeladas | Patatas gajo              | ALTERNATIVE | Variante explícita                    |
| Patatas gajo              | Patatas fritas congeladas | ALTERNATIVE | Variante explícita                    |

## Casos rechazados revisados

| Lista        | Producto            | Resultado | Motivo                           |
| ------------ | ------------------- | --------- | -------------------------------- |
| Plátano      | Manzana             | REJECTED  | Sin relación explícita           |
| Plátano      | Pera                | REJECTED  | Sin relación explícita           |
| Plátano      | Mango               | REJECTED  | Sin relación explícita           |
| Banana       | Piña                | REJECTED  | Sin relación explícita           |
| Plátano      | Smoothie de banana  | REJECTED  | Producto derivado                |
| Mandarina    | Naranja             | REJECTED  | Relación deliberadamente ausente |
| Nuggets      | Croquetas de pollo  | REJECTED  | Preparado distinto               |
| Nuggets      | Pechuga de pollo    | REJECTED  | Producto base distinto           |
| Leche        | Batido de chocolate | REJECTED  | Derivado no solicitado           |
| Tomate       | Salsa de tomate     | REJECTED  | Derivado no solicitado           |
| Pollo        | Croquetas de pollo  | REJECTED  | Preparado distinto               |
| Atún         | Burger de atún      | REJECTED  | Derivado no solicitado           |
| Hamburguesa  | Albóndigas          | REJECTED  | Sin relación explícita           |
| Pan          | Empanada de atún    | REJECTED  | Sin relación explícita           |
| Nuggets      | Fingers de pescado  | REJECTED  | Categoría incompatible           |
| Hamburguesas | Burger vegetal      | REJECTED  | Categoría incompatible           |

## Auditoría de candidatos con D1 local

Se cruzaron los 98 productos con 15 intenciones comunes. La fecha sólo tenía cuatro ofertas
vigentes y ninguna pertenecía a un concepto alternativo, por lo que no se fabricó ninguna
sugerencia naranja. Los matches no bajos observados fueron: Pollo (1), Pan (1), Yogures (1), Café
(1), Detergente (2) y Champú (1). Plátano, Nuggets, Hamburguesas, Patatas fritas, Leche, Tomate,
Atún, Huevos y Papel higiénico no tuvieron candidatos válidos en ese catálogo. No apareció ninguna
alternativa absurda.

## Rendimiento y aislamiento

El matcher continúa dentro de `GET /api/offers/for-list`. La prueba de regresión ejecuta añadir,
marcar/desmarcar, editar y eliminar con 10 y con 1.000 ofertas persistidas sin abrir la ruta de
ofertas. No se añadió ninguna query, fetch ni dependencia a `ShoppingStore`.
