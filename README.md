# 🛒 Family Shopping

Aplicación familiar privada, mobile-first y PWA para gestionar una **lista de la compra compartida en tiempo real** entre varios móviles.

El proyecto nació para sustituir la típica lista en papel por una aplicación muy sencilla de utilizar durante la compra: añadir productos, marcar lo que ya se ha comprado, recordar preferencias habituales y consultar ofertas relevantes sin complicar el flujo principal.

Actualmente está especialmente optimizada para el uso familiar en **Lidl**, con integración real de catálogo y ofertas.

## 🌐 Producción

**Aplicación:**
https://family-shopping.lorenzo-bellido-b.workers.dev

La aplicación, la API y el WebSocket se sirven desde un único Cloudflare Worker y bajo el mismo origen.

---

# ✨ Funcionalidades principales

## 📝 Lista de la compra compartida

La pantalla principal permite:

* Añadir productos.
* Editar nombre, cantidad, unidad y supermercado preferido.
* Marcar y desmarcar productos como comprados.
* Eliminar productos.
* Vaciar la lista.
* Completar un ciclo de compra.
* Pasar productos pendientes a una nueva lista.
* Mantener el orden original de los productos.

Cuando un producto se compra:

* permanece exactamente en su posición;
* se muestra tachado y visualmente atenuado;
* puede volver a desmarcarse con un toque.

La lista no separa artificialmente los productos en bloques de “pendientes” y “comprados”.

---

# ⚡ Rendimiento

La lista está diseñada para que el CRUD sea independiente del sistema de ofertas.

La arquitectura separa:

```text
ShoppingStore
├── CRUD optimista
├── estado de la lista
├── IndexedDB / offline
└── WebSocket

OffersStore
├── carga bajo demanda
├── caché
├── matching
├── alternativas
├── categorías
└── paginación
```

Esto evita que operaciones como:

```text
añadir
tachar
editar
eliminar
```

dependan del catálogo Lidl o del cálculo de ofertas.

Se utiliza **Optimistic UI** para que las acciones principales se reflejen inmediatamente en pantalla y se haga rollback si el backend devuelve un error.

El autocomplete utiliza debounce y mantiene una única petición en vuelo.

Las consultas de ofertas se cancelan al abandonar esa pantalla y su información se mantiene cacheada durante periodos cortos para evitar cargas repetitivas.

---

# 🔄 Sincronización en tiempo real

Cada hogar dispone de una lista compartida entre sus dispositivos.

La sincronización utiliza:

* Cloudflare Durable Objects.
* WebSockets.
* WebSocket Hibernation API.
* D1 como fuente de verdad.

Flujo simplificado:

```text
Móvil A
   │
   │ REST mutation
   ▼
Cloudflare Worker
   │
   ├── D1
   │
   └── Durable Object
              │
              ▼
           Móvil B
```

El dispositivo que realiza una modificación obtiene feedback inmediatamente mediante Optimistic UI.

Los demás dispositivos reciben la actualización mediante WebSocket.

D1 continúa siendo siempre la fuente de verdad canónica.

---

# 📱 PWA y funcionamiento offline

Family Shopping puede instalarse como aplicación en Android desde el navegador.

Incluye:

* manifest PWA;
* service worker;
* instalación en pantalla de inicio;
* caché de la aplicación;
* almacenamiento local mediante IndexedDB.

La última lista conocida queda disponible aunque se pierda temporalmente la conexión.

También es posible marcar y desmarcar productos sin cobertura. Estas operaciones se guardan en una cola local y se sincronizan posteriormente.

La creación de nuevos productos continúa requiriendo conexión.

---

# 👨‍👩‍👧 Hogares y dispositivos

La aplicación no utiliza:

* cuentas;
* email;
* contraseña.

La autenticación está basada en dispositivos.

## Primer dispositivo

El primer dispositivo inicializa el hogar utilizando una clave privada de bootstrap:

```text
HOUSEHOLD_ACCESS_KEY
```

Esta clave sólo se utiliza durante la inicialización.

Después, el servidor genera un token aleatorio específico para el dispositivo y almacena únicamente su hash SHA-256.

## Segundo dispositivo

Los siguientes móviles se vinculan desde:

```text
Ajustes → Añadir otro móvil
```

mediante:

* QR;
* código temporal.

Cada móvil recibe su propio token.

Los tokens nunca se comparten entre dispositivos.

---

# 🧠 Preferencias aprendidas

La aplicación aprende determinadas decisiones del hogar.

Por ejemplo:

```text
Leche
→ Lidl
→ cantidad habitual
→ unidad habitual
```

Estas preferencias pueden reutilizarse en futuras listas y en productos frecuentes.

Las preferencias sobreviven entre distintos ciclos de compra.

---

# 🏪 Supermercados

El dominio está preparado para trabajar con:

* Lidl
* Mercadona
* Carrefour
* DIA
* Cualquier supermercado

Sin embargo, actualmente la integración inteligente se centra deliberadamente en:

## 🟦 Lidl

Lidl es el único proveedor de catálogo y ofertas activado actualmente.

Los demás supermercados pueden seguir utilizándose como **preferencia de compra dentro de la lista**, pero su catálogo/ofertas no se procesan todavía.

La decisión actual del proyecto es priorizar la calidad de la experiencia familiar con Lidl antes de ampliar a nuevas cadenas.

---

# 🔥 Ofertas Lidl reales

Las ofertas no son datos de demostración.

El Worker importa información real desde fuentes públicas oficiales de Lidl y la almacena en D1.

El flujo es:

```text
Cloudflare Cron
      │
      ▼
LidlProvider
      │
      ▼
normalización
      │
      ▼
D1
      │
      ▼
Family Shopping
```

La aplicación nunca consulta Lidl durante el uso normal.

Los usuarios consultan únicamente datos previamente importados a D1.

Esto mantiene la aplicación rápida y evita depender en tiempo real de servicios externos.

---

# ⏰ Actualización automática de Lidl

El catálogo se actualiza automáticamente aproximadamente a:

```text
05:00 Europe/Madrid
```

Cloudflare Cron utiliza UTC, por lo que existen dos triggers:

```text
0 3 * * *
0 4 * * *
```

El Worker calcula la hora real utilizando:

```text
Europe/Madrid
```

y sólo ejecuta un import válido al día.

Esto permite soportar automáticamente:

* CET;
* CEST;
* cambios de horario de verano/invierno.

No existen fechas DST hardcodeadas.

---

# 🛡️ Protección del catálogo Lidl

El importador está diseñado para conservar siempre el último dataset válido.

Por ejemplo:

```text
import falla
→ datos anteriores permanecen disponibles
```

También se detectan anomalías como:

* respuesta sin productos;
* caída extrema en el número de productos;
* import concurrente;
* import bloqueado;
* respuestas excesivamente grandes.

Los errores de una campaña no deben afectar al funcionamiento de la lista familiar.

---

# 🗂️ Categorías de ofertas

Las ofertas pueden navegarse mediante categorías independientes de las categorías visuales de la lista.

Actualmente se contemplan categorías como:

```text
✨ Todas
🍎 Comida
🥤 Bebidas
🥬 Frescos
🧹 Limpieza
🧴 Higiene
🏠 Hogar
🌱 Jardín
🔧 Bricolaje
👕 Ropa
👶 Bebé
🐾 Mascotas
🔌 Electrónica
🛒 Otros
```

El backend permite filtrar directamente por categoría para evitar descargar todo el catálogo innecesariamente.

Las tarjetas se cargan de forma progresiva mediante paginación / “Ver más”.

---

# 🎯 Ofertas relacionadas con la lista

Family Shopping puede relacionar productos escritos de forma genérica por la familia con productos concretos de Lidl.

Ejemplo:

```text
Lista:
Atún

Lidl:
NIXE Atún claro
```

El matching utiliza un algoritmo determinista basado en:

* nombre normalizado;
* tokens;
* categorías;
* variantes;
* reglas de incompatibilidad;
* preferencias aprendidas.

No utiliza:

* OpenAI;
* Gemini;
* LLM;
* embeddings externos;
* servicios de pago.

---

# 🟢 Coincidencias

Una coincidencia indica que el producto representa razonablemente lo que la familia ha escrito.

Ejemplo:

```text
Plátano
→ Plátano de Canarias
```

Se representa visualmente mediante un estilo verde.

El sistema diferencia entre niveles de confianza internos y evita realizar matches automáticos cuando existen varias opciones ambiguas.

---

# 🟠 Productos alternativos

Además de coincidencias, Family Shopping puede sugerir productos que **no son exactamente lo mismo**, pero que podrían servir como sustitución razonable.

Ejemplo:

```text
Nuggets
→ Fingers de pollo
```

o:

```text
Plátano
→ Banana
```

Estas recomendaciones aparecen con un estilo naranja para diferenciarlas claramente de una coincidencia.

La filosofía del matcher es deliberadamente conservadora:

```text
si hay dudas
→ no recomendar
```

No se generan alternativas únicamente porque dos productos pertenezcan a la misma categoría.

---

# 👍 “También me sirve”

Una alternativa puede marcarse como:

```text
También me sirve
```

La relación se aprende exclusivamente para ese hogar.

Por ejemplo:

```text
Nuggets
→ Fingers de pollo
```

puede quedar registrada como alternativa aceptable sin convertirse nunca en un match exacto.

También puede marcarse:

```text
No me interesa
```

para evitar que vuelva a recomendarse.

Estas preferencias sobreviven entre listas y campañas Lidl.

---

# 📦 Cantidades, unidades y envases

El proyecto incluye un modelo `PackageDescriptor` capaz de interpretar formatos como:

```text
750 g
1 kg
3x65 g
18x33 cl
Aprox. 400 g
A granel
```

Permite calcular:

* cantidad solicitada;
* tamaño del envase;
* número de envases necesarios;
* cantidad total comprada;
* exceso de producto;
* coste estimado.

Los resultados pueden clasificarse como:

```text
EXACT
GOOD
OVERBUY
UNKNOWN
INCOMPATIBLE
```

Ejemplo:

```text
Lista:
Uva
1 kg

Producto Lidl:
750 g

Resultado:
2 envases
1,5 kg comprados
500 g de exceso
OVERBUY
```

---

# 💰 Promociones

El motor de precios puede representar promociones como:

* precio especial;
* descuento porcentual;
* Lidl Plus;
* 3x2;
* segunda unidad con descuento;
* cashback.

Ejemplo:

```text
3x2
precio: 2,99 €
6 unidades

coste:
11,96 €
```

Los cálculos monetarios utilizan céntimos enteros para evitar errores de precisión con `float`.

---

# 🟦 Lidl Plus

La arquitectura distingue entre:

```text
precio normal
oferta general
precio Lidl Plus
```

Un precio condicionado por Lidl Plus nunca se trata silenciosamente como precio normal.

Ejemplo:

```text
Normal       2,99 €
Oferta       2,35 €
Lidl Plus    1,89 €
```

El sistema conserva los distintos escenarios para poder determinar posteriormente el coste realmente aplicable según la configuración del hogar.

---

# 🛍️ “Ofertas de tu lista”

La pestaña Ofertas prioriza los productos pendientes de la compra.

Conceptualmente:

```text
🎯 Ofertas de tu lista

Producto de la lista
    │
    ├── 🟢 coincidencias
    └── 🟠 alternativas

✨ Todas las ofertas Lidl
```

Los productos ya comprados no se priorizan.

---

# 🖼️ Experiencia visual de ofertas

Las tarjetas de ofertas están diseñadas para mostrar únicamente la información relevante:

* producto;
* precio;
* precio anterior;
* Lidl Plus cuando existe;
* formato;
* imagen oficial cuando está disponible.

La intención es evitar mostrar información técnica interna del matcher o del importador.

Las imágenes se cargan únicamente dentro de Ofertas y de forma lazy para no afectar al rendimiento de la Lista.

---

# 🧩 Arquitectura

```text
                    ┌─────────────────────┐
                    │     Angular PWA     │
                    │                     │
                    │ ShoppingStore       │
                    │ OffersStore         │
                    │ IndexedDB           │
                    └──────────┬──────────┘
                               │
                         HTTPS / WS
                               │
                    ┌──────────▼──────────┐
                    │ Cloudflare Worker   │
                    │                     │
                    │ REST API            │
                    │ Auth                │
                    │ Matching            │
                    │ Offers              │
                    │ Imports             │
                    └──────┬───────┬──────┘
                           │       │
                  ┌────────▼─┐   ┌─▼────────────────┐
                  │    D1    │   │ Durable Object   │
                  │          │   │                  │
                  │ source   │   │ realtime         │
                  │ of truth │   │ WebSockets       │
                  └──────────┘   └──────────────────┘

                         Cloudflare Cron
                               │
                               ▼
                         LidlProvider
                               │
                               ▼
                         Fuentes Lidl
```

---

# 🛠️ Stack tecnológico

## Frontend

* Angular 22
* TypeScript
* Standalone Components
* Signals
* SCSS
* Angular PWA / Service Worker
* IndexedDB

## Backend

* Cloudflare Workers
* TypeScript
* REST API
* WebSockets
* WebSocket Hibernation API
* Durable Objects

## Persistencia

* Cloudflare D1
* SQLite
* Migraciones SQL

## Infraestructura

* Workers Static Assets
* Cloudflare Cron Triggers
* `workers.dev`
* GitHub

---

# 🔐 Seguridad

Algunas decisiones de seguridad importantes:

* no existen contraseñas de usuario;
* cada dispositivo recibe su propio token;
* sólo se almacena el hash del token;
* aislamiento por household;
* queries SQL parametrizadas;
* validación runtime de DTOs;
* endpoints privados protegidos;
* bootstrap separado del uso normal;
* secretos de producción almacenados mediante Cloudflare Secrets;
* `.dev.vars` ignorado por Git;
* el frontend nunca recibe claves administrativas;
* el importador de supermercados utiliza allowlists y límites de respuesta.

---

# 📋 Requisitos

* Node.js 24 LTS o compatible con Angular 22.
* npm 11.
* Cuenta de Cloudflare para Worker/D1.
* Wrangler.

---

# 🚀 Instalación

```bash
npm install
```

Comprobar el proyecto completo:

```bash
npm run verify
```

---

# 💻 Desarrollo local full-stack

Preparar D1 local:

```bash
npm run db:setup:local
```

Crear:

```text
.dev.vars
```

a partir de:

```text
.dev.vars.example
```

y configurar los secretos locales necesarios.

Después:

```bash
npm run dev
```

Esto:

1. compila Angular;
2. inicia Cloudflare Worker local;
3. sirve Angular mediante Static Assets;
4. activa D1 local;
5. activa Durable Objects;
6. expone API y WebSocket.

Para trabajar únicamente en Angular con HMR:

```bash
npm run start
```

En ese modo la API real del Worker no está disponible.

---

# 📜 Scripts

| Comando                    | Función                                |
| -------------------------- | -------------------------------------- |
| `npm run start`            | Angular con HMR, sin Worker            |
| `npm run dev`              | Aplicación full-stack local            |
| `npm run build`            | Build Angular de producción            |
| `npm run test`             | Tests Angular + Worker/D1              |
| `npm run lint`             | ESLint                                 |
| `npm run typecheck`        | TypeScript estricto                    |
| `npm run format:check`     | Comprueba formato Prettier             |
| `npm run verify`           | Formato + lint + tipos + tests + build |
| `npm run db:migrate:local` | Migraciones pendientes sobre D1 local  |
| `npm run db:seed:local`    | Datos de referencia locales            |
| `npm run db:setup:local`   | Migraciones + seed local               |
| `npm run deploy`           | Build y despliegue a Cloudflare        |

---

# 🗄️ Base de datos

La D1 de producción es:

```text
family-shopping-db
```

El binding está definido en:

```text
wrangler.jsonc
```

Las migraciones se encuentran en:

```text
database/migrations
```

Nunca se modifican migraciones que ya hayan sido aplicadas.

Para desarrollo:

```bash
npm run db:migrate:local
```

Para producción, las migraciones pendientes se revisan y aplican explícitamente antes del deploy.

---

# ✅ Calidad

El proyecto dispone de una suite extensa de tests para:

* Angular;
* Worker;
* D1;
* CRUD;
* autenticación;
* pairing;
* realtime;
* offline;
* categorías;
* matching;
* alternativas;
* falsos positivos;
* cantidades;
* envases;
* promociones;
* import Lidl;
* rendimiento.

Antes de integrar o desplegar cambios:

```bash
npm run verify
git diff --check
npx wrangler deploy --dry-run
```

El proyecto cuenta actualmente con **más de 300 pruebas automatizadas**.

---

# 🚢 Despliegue

Verificar:

```bash
npm run verify
```

Después:

```bash
npx wrangler deploy --dry-run
```

Si existen nuevas migraciones D1:

```bash
npx wrangler d1 migrations list family-shopping-db --remote
npx wrangler d1 migrations apply family-shopping-db --remote
```

Finalmente:

```bash
npx wrangler deploy
```

No es necesario recrear D1 ni volver a configurar secrets existentes en cada despliegue.

---

# 📚 Documentación

La documentación técnica detallada se encuentra en:

* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
* [`docs/API.md`](docs/API.md)
* [`docs/DATABASE.md`](docs/DATABASE.md)
* [`docs/OFFLINE.md`](docs/OFFLINE.md)
* [`docs/SUPERMARKETS.md`](docs/SUPERMARKETS.md)
* [`docs/PROGRESS.md`](docs/PROGRESS.md)
* [`docs/PRODUCTION.md`](docs/PRODUCTION.md)
* [`docs/PAIRING_TEST.md`](docs/PAIRING_TEST.md)

También existen auditorías específicas para determinados subsistemas, como el matcher de alternativas.

---

# 🧭 Dirección actual del proyecto

Family Shopping se encuentra actualmente en una fase de **uso familiar real**.

La prioridad ya no es añadir funcionalidades por añadir, sino observar cómo se utiliza durante compras reales y mejorar:

* velocidad;
* claridad;
* accesibilidad;
* sugerencias;
* productos habituales;
* ofertas realmente útiles;
* experiencia en tienda.

La estrategia actual es mantener **Lidl como único proveedor inteligente** y dejar la integración completa de Mercadona, DIA y Carrefour para una fase posterior.

El ciclo de desarrollo buscado es:

```text
uso real
   ↓
feedback familiar
   ↓
problema concreto
   ↓
mejora pequeña
   ↓
tests
   ↓
producción
   ↓
nuevo uso real
```

---

# 🎯 Objetivo

Family Shopping no pretende ser simplemente otra aplicación de listas.

El objetivo es conseguir que una lista familiar muy sencilla pueda aprovechar progresivamente información contextual:

```text
qué necesitamos
+
qué compramos normalmente
+
dónde lo compramos
+
qué cantidad solemos comprar
+
qué productos están de oferta
+
qué alternativas podrían servirnos
```

sin sacrificar lo más importante:

**abrir la aplicación y poder añadir o tachar un producto en segundos.**
