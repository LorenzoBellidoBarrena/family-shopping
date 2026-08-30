# PWA, caché y sincronización offline

## Instalación y shell

Angular Service Worker precachea la aplicación, el manifest y los iconos. No cachea `/api`: una
respuesta privada no debe quedar mezclada con la caché HTTP de otro dispositivo o sesión.

La instalación puede hacerse desde el navegador Android cuando éste ofrezca “Instalar aplicación”.
La comprobación real del service worker requiere una build de producción servida por HTTPS o
localhost; `ng serve` no lo registra.

## Datos guardados

IndexedDB `family-shopping-cache` contiene:

- `state/active-cycle`: última lista canónica o reconciliada disponible en ese dispositivo.
- `operations/<itemId>`: último estado deseado de marcado para cada producto.

Sin red se puede consultar la lista y marcar o desmarcar productos. Altas, ediciones, eliminaciones,
pairing y cierres se bloquean porque requieren validación inmediata del servidor.

La categoría forma parte del item almacenado dentro del ciclo, así que el mismo emoji permanece al
perder la conexión y durante toggles offline. Las copias creadas antes de `ProductCategory` se leen
como `OTHER`; no hace falta cambiar la versión de IndexedDB porque no se modificó la estructura de
los object stores. La creación offline continúa deliberadamente fuera del alcance actual: el único
tipo de operación en cola sigue siendo marcar/desmarcar.

## Reconciliación determinista

Al volver la red, el cliente lee primero el ciclo activo de D1. Para cada operación pendiente, en
orden de IndexedDB, compara el estado canónico con `desiredChecked`: sólo llama al toggle si son
distintos. Si el item ya no existe, descarta esa operación. Después guarda el ciclo resultante y
vacía las operaciones aplicadas. Varias pulsaciones offline sobre un mismo item colapsan al último
estado deseado y no alteran su posición.

Una interrupción durante este proceso es segura: las operaciones no confirmadas permanecen para el
siguiente intento, y cada intento vuelve a comparar contra D1 antes de mutar.

Ofertas sigue siendo exclusivamente online y no amplía IndexedDB. Al abandonar esa vista se abortan
catálogo y matching en curso; no pueden retrasar un toggle offline ni la reconciliación de Lista. El
cache de Ofertas vive sólo en memoria durante la sesión y nunca se mezcla con la copia canónica del
ciclo familiar.

## Límites de seguridad

El token del dispositivo vive en `localStorage` y la lista offline en IndexedDB. Son privados frente
a otros hogares, pero cualquier script que lograse ejecutarse en el mismo origen podría acceder a
ellos. Deben mantenerse una CSP estricta y dependencias actualizadas. Borrar los datos del sitio
elimina la copia local y obliga a volver a vincular el móvil; no revoca por sí solo el registro del
dispositivo en D1.
