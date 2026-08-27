# Family Shopping

Aplicación familiar privada y mobile-first para compartir una lista de la compra. Angular y la API
de Cloudflare Workers se publican bajo un único origen. Durable Objects distribuye cambios en tiempo
real por hogar y D1 permanece como fuente de verdad.

La interfaz permite añadir, editar, marcar, eliminar, completar o vaciar la lista, recuperar
preferencias y vincular móviles por QR. Es instalable como PWA, conserva la última lista en
IndexedDB y permite marcar productos sin conexión para sincronizarlos después.

## Requisitos

- Node.js 24 LTS o compatible con Angular 22.
- npm 11.

## Instalación y comprobación

```bash
npm install
npm run verify
```

## Desarrollo local full-stack

Prepara D1 local:

```bash
npm run db:setup:local
```

Copia `.dev.vars.example` como `.dev.vars`, sustituye el placeholder por una clave local y arranca
el Worker con Angular compilado:

```bash
npm run dev
```

El valor de `.dev.vars` queda ignorado por Git. `HOUSEHOLD_ACCESS_KEY` sólo se envía al endpoint de
bootstrap del primer dispositivo; el servidor entrega después un token de dispositivo y almacena
únicamente su SHA-256.

Para trabajar sólo sobre la shell Angular con HMR puede usarse `npm run start`. En ese modo la API
del Worker no está disponible.

## Scripts

| Comando                    | Función                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `npm run start`            | Servidor Angular con HMR, sin Worker.                              |
| `npm run dev`              | Compila Angular e inicia Worker, Static Assets y bindings locales. |
| `npm run build`            | Build Angular de producción.                                       |
| `npm run test`             | 11 pruebas Angular y 18 integraciones Worker/D1.                   |
| `npm run lint`             | ESLint para Angular, plantillas y Worker.                          |
| `npm run typecheck`        | TypeScript estricto de frontend, Worker y pruebas.                 |
| `npm run format:check`     | Comprueba Prettier sin modificar archivos.                         |
| `npm run verify`           | Formato, lint, tipos, tests y build.                               |
| `npm run db:migrate:local` | Aplica migraciones pendientes sólo a D1 local.                     |
| `npm run db:seed:local`    | Aplica los datos de referencia a D1 local.                         |
| `npm run db:setup:local`   | Ejecuta migraciones y seed locales.                                |
| `npm run deploy`           | Build y despliegue; requiere configuración remota real.            |

No se ha creado ninguna base remota. `wrangler.jsonc` conserva
`REPLACE_WITH_D1_DATABASE_ID` hasta que Cloudflare devuelva un ID real en la fase de producción.

Consulta [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATABASE.md](docs/DATABASE.md),
[docs/API.md](docs/API.md), [docs/OFFLINE.md](docs/OFFLINE.md) y
[docs/PROGRESS.md](docs/PROGRESS.md).
