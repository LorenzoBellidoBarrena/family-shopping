# Prueba local de pairing con Chrome y Edge

1. Prepara sólo los recursos locales con `npm run db:setup:local`.
2. Define en `.dev.vars` una `HOUSEHOLD_ACCESS_KEY` exclusivamente local y ejecuta `npm run dev`.
3. Abre `http://localhost:8787` en Chrome. Si conserva datos de pruebas anteriores, borra los datos
   del sitio para `localhost:8787`.
4. Elige **Configurar hogar**, introduce la clave local y pulsa **Crear hogar**.
5. Añade uno o dos productos y entra en **Ajustes → Añadir otro móvil**.
6. Abre en Edge el enlace mostrado o copia la URL `/pair?code=...`. Edge debe mostrar
   **Vincular este dispositivo**, nunca **Clave familiar**.
7. Pulsa **Vincular dispositivo**. Edge debe navegar a `/` y mostrar la lista ya existente.
8. Con ambos navegadores visibles, añade **Leche** en Chrome: debe aparecer en Edge sin recargar.
9. Marca **Leche** en Edge: debe aparecer tachada en Chrome sin recargar y en la misma posición.
10. Para probar la entrada manual, abre una ventana InPrivate nueva de Edge, genera otro código en
    Chrome, entra en `/`, elige **Vincular este móvil** e introduce el **Código de vinculación**.

Cada código sólo funciona una vez y caduca a los diez minutos. Para repetir la prueba hay que generar
uno nuevo. Chrome y Edge deben acceder al mismo host y puerto; no mezcles `localhost` con `127.0.0.1`.
