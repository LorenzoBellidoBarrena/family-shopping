# Producción y seguridad

URL activa: `https://family-shopping.lorenzo-bellido-b.workers.dev`.

## Topología validada

La aplicación se despliega como un único Cloudflare Worker con Workers Static Assets. `/api/*` y
`/ws/*` ejecutan primero el Worker; Angular se sirve como SPA desde el binding `ASSETS`. D1 usa el
binding `DB` y `HOUSEHOLD_COORDINATOR` es un Durable Object SQLite-backed con WebSocket Hibernation.

No se utiliza Cloudflare Pages ni otro backend. `workers_dev` permanece habilitado para obtener una
URL `*.workers.dev` bajo el mismo origen.

## Hardening aplicado

- Todas las respuestas REST llevan `Cache-Control: no-store` y errores sin detalles internos.
- Worker y Static Assets envían CSP sin `unsafe-inline`, anti-framing, `nosniff`, política de
  permisos, referrer estricto, aislamiento de recursos y HSTS sobre HTTPS.
- El build Angular no genera CSS ni manejadores inline, por lo que cumple la CSP.
- Los estilos de `app.scss` forman parte del bundle CSS externo; no deben volver a `styleUrl` sin
  configurar previamente nonces CSP compatibles con Angular.
- Los cuerpos JSON se limitan a 16 KiB antes de procesarse.
- Las rutas privadas y `/ws` validan un device token; pairing sólo se crea desde un device válido.
- D1 almacena SHA-256 de tokens y códigos, nunca sus valores completos.
- El token WebSocket viaja como subprotocolo y no aparece en la URL.
- Los inputs tienen límites y SQL usa parámetros enlazados.
- Angular escapa el contenido mostrado y no usa `innerHTML` ni APIs de confianza eludida.

## Rate limiting

Bootstrap deja de comprobar la clave en cuanto existe el hogar. El pairing usa aproximadamente 40
bits aleatorios, caduca en diez minutos y es de un solo uso. No se añadió un contador en memoria del
Worker porque no sería consistente entre isolates, ni uno global en D1 que permitiría bloquear a la
familia mediante abuso.

Antes de abrir producción conviene crear reglas nativas de Cloudflare por IP para
`/api/bootstrap`, `/api/pairings/consume` y los intentos fallidos de `/ws`. Esta configuración remota
queda pendiente hasta autenticar Wrangler y debe probarse sin bloquear los dos móviles legítimos.

## Secuencia de despliegue

1. `npx wrangler login`
2. `npx wrangler whoami`
3. `npx wrangler d1 list --json`
4. Si no existe: `npx wrangler d1 create family-shopping-db --location weur`
5. Copiar el `database_id` real devuelto a `wrangler.jsonc`.
6. `npx wrangler secret list`; en un Worker nuevo puede responder que todavía no existe.
7. Ejecutar `npx wrangler secret put HOUSEHOLD_ACCESS_KEY` e introducir el valor privado. Wrangler
   puede pedir confirmación para crear el Worker por primera vez.
8. `npx wrangler d1 migrations apply DB --remote`
9. `npx wrangler d1 migrations list DB --remote`
10. `npm run verify`
11. `npx wrangler deploy`

En una cuenta nueva, antes del paso 11 hay que abrir una vez **Workers & Pages** en Cloudflare y
crear/confirmar el subdominio `workers.dev`; de lo contrario la API responde con el código `10063`.

El valor del secreto debe introducirlo el propietario en el prompt interactivo y nunca enviarse por
chat, guardarse en `.dev.vars` como valor de producción ni escribirse en Git.

## Smoke tests no destructivos

Después del deploy se comprueban `GET /`, manifest, service worker y `GET /api/health`. Una llamada
privada sin token debe responder `401`; no se ejecuta bootstrap, pairing ni ninguna mutación durante
el smoke test.

Resultado del despliegue actual: shell, manifest, service worker, `/pair` y salud `200`; API privada
sin token y WebSocket sin credencial `401`; `/ws` sin upgrade `426`. D1 conserva cero households y
devices hasta que el propietario realice el bootstrap desde el primer móvil.

La corrección de estilos está desplegada en la versión `b619bdfb-55c9-45c0-b43e-6ac3b0c1de31`:
producción entrega `styles-MCCCH2BB.css` con los estilos completos y CSP `style-src 'self'`.

La versión completa con categorías visuales se desplegó el 28 de agosto de 2026 como
`f5ba83b1-1686-49ec-b9cd-c6de20197cc0`. D1 remoto tiene aplicadas `0001`–`0004`, el backfill dejó
los items previos en `OTHER` sin pérdidas y el seed idempotente confirmó las cinco cadenas base.
El smoke posterior confirmó shell y ruta SPA `200`, salud `200`, manifest standalone, service
worker, CSS externo, JSON `404` para API desconocida, protección `401` de API privada y WebSocket,
y binding del Durable Object SQLite.

La fundación Carrefour se desplegó inicialmente como `12a5eb2a-b17e-4e30-a193-2c82f6de74e3`.
Desde el 29 de agosto de 2026, `0006_nullable_offer_validity.sql` también está aplicada y Lidl tiene
datos reales validados. `SUPERMARKET_FEATURE_ENABLED` vale `true`, `IMPORT_ADMIN_KEY` está
configurado y `triggers.crons` permanece vacío. Los endpoints administrativos siguen protegidos por
el secret aunque el flag visible cambie.

## Puesta en marcha de los móviles

1. En el primer Android, abrir la URL en Chrome y elegir **Configurar hogar**.
2. Introducir `HOUSEHOLD_ACCESS_KEY` y pulsar **Crear hogar**. La clave no se conserva en el cliente.
3. En **Ajustes → Añadir otro móvil**, generar el QR/código temporal.
4. Escanearlo con el segundo Android o abrir el enlace; confirmar **Vincular dispositivo**.
5. Para instalar la PWA, abrir el menú de Chrome y elegir **Instalar aplicación** o **Añadir a
   pantalla de inicio**. Repetirlo en el segundo móvil.

## Limitaciones conocidas

- Falta validar el flujo completo físicamente en los dos Android.
- No hay todavía UI de revocación de dispositivos.
- El device token vive en `localStorage`; CSP reduce el riesgo XSS, pero un script de mismo origen
  comprometido podría leerlo.
- No se configuraron reglas nativas de rate limiting porque requieren una decisión de umbrales en la
  cuenta; el código temporal mantiene 40 bits aproximados, uso único y diez minutos de caducidad.
