# Negocios, operación y avisos con sonido

Se mantiene Angular y Firebase con el motor directo. Las funciones usan los
mismos establecimientos, canchas y reservas que ya consultan cliente y dueño.

## Recorrido del negocio

1. El superadmin abre **Agregar negocio** y completa dos pasos: nombre,
   ubicación, correo del dueño, adelanto real y datos de su primera cancha.
2. Se crean de forma atómica el negocio aprobado, su ficha en borrador, su
   cancha, la invitación y la auditoría. Horarios y precios quedan pendientes;
   las reservas permanecen deshabilitadas. No se inventan montos ni horarios.
3. El dueño entra con el correo invitado, lo verifica y abre **Invitaciones a
   negocios**, desde su cuenta o desde la campana. Al aceptar, se asignan su
   membresía y acceso al negocio. No puede aceptar invitaciones ajenas ni
   reemplazar al responsable de un negocio ya asignado.
4. Desde **Mi local**, guarda horarios, precios y datos reales de pago con QR.
   Las tarifas requieren guardarse para confirmar su versión canónica, incluso
   si anteriormente se habían cargado precios de referencia.
5. El superadmin revisa la ficha y confirma **Publicar y habilitar reservas**.
   Las reglas comprueban la configuración del negocio y el QR guardado antes
   de habilitar la agenda. Los comprobantes siguen verificándose manualmente.

La entrega [Multicanchas y tarifas](MULTICANCHAS_Y_TARIFAS.md) amplía el alta y la
publicación a varias canchas, con precios propios de fútbol, vóley y otros
deportes. También permite agregar canchas a negocios existentes y editar sus
tarifas desde el superadmin. No se eliminan ni se convierten las canchas existentes.
Las invitaciones se reciben dentro de GrassGo; no se envían correos ni mensajes
automáticos de invitación. El enlace de verificación se solicita desde la cuenta.

## Operación conectada

El resumen muestra por negocio las reservas confirmadas de hoy, comprobantes
vigentes por revisar de hoy y partidos en curso. Las dos primeras cifras usan
la fecha de Lima; los partidos en curso también reconocen los que cruzan
medianoche. El reloj reconoce su final automático a los 60 minutos.

El superadmin consulta ocupaciones y metadatos operativos, sin abrir imágenes
de comprobantes ni datos privados de clientes. El indicador `reviewPending`
solo puede acompañar una presentación real de comprobante. Confirmar o
rechazar requiere la revisión autorizada del dueño y retira ese indicador.
El adelanto se toma de la configuración del negocio y debe caber en el precio
de la reserva. El valor existente de El Puma se conserva.

Los cambios de contacto, horarios, cierres, precios y QR añaden una entrada
sanitizada al historial común en la misma transacción de su historial privado.
El registro común incluye autor, tipo de cambio y hora; no copia imágenes,
teléfonos ni valores anteriores. Los cambios de estado, altas, aceptación y
publicación también quedan vinculados a sus auditorías.

## Campana y sonido

- **Cliente:** confirmación, rechazo, inicio y fin de sus reservas; nuevas
  invitaciones dirigidas a su correo verificado.
- **Dueño:** nuevas solicitudes y comprobantes de sus establecimientos.
- **Superadmin:** altas, asignaciones, publicaciones, cambios de configuración,
  comprobantes pendientes de hoy e inicio/final de partidos.

Cada apartado dispone de campana, contador, lista de avisos, **Activar sonido**,
**Probar sonido**, **Silenciar** y **Marcar todos como leídos**. El audio requiere
la pulsación explícita del usuario. El navegador debe permitirlo y GrassGo debe
seguir abierto; no se incorporaron notificaciones push con la página cerrada.

La primera carga muestra el historial sin hacer sonar avisos antiguos. Se
separan preferencias y avisos por cuenta y por portal; cerrar sesión o cambiar
de cuenta limpia las escuchas y el audio. Los avisos repetidos se deduplican,
incluidos los de varias pestañas cuando el navegador admite Web Locks.

## Windows y validación focal

```powershell
# 6 casos Angular y 4 casos de reglas; no ejecuta la suite completa.
npm run test:connected
npm run build
Start-Process 'https://grassgo.web.app/superadmin/inicio'
```

Las pruebas de permisos usan exclusivamente emuladores y un proyecto `demo-*`.
La validación focal terminó con **6 casos Angular y 4 de reglas aprobados**.
No se ejecutó la suite completa en esta entrega, por indicación del usuario.
La compilación de producción fue correcta. El índice de solicitudes por
establecimiento y creación está en estado `READY`, y las reglas y Hosting se
publicaron en `grassgo.web.app`. Persisten advertencias de presupuesto de tamaño;
no se aumentaron los límites de compilación.
La cabecera de caché cubre también las rutas de la aplicación, evitando que el
navegador conserve durante una hora el HTML de una versión anterior. Las
imágenes y otros recursos conservan su revalidación configurada.
En la sesión real se comprobó la campana y el estado **Sonido activado** en los
tres portales, el formulario guiado y el resumen de El Puma. No se crearon
negocios ficticios ni se habilitaron reservas sin el QR y los datos faltantes.
[Captura de avisos con sonido](screenshots/avisos-sonido-superadmin.jpg).
Los archivos principales son `platform-onboarding.service.ts`, los componentes
de alta e invitaciones, `notification.service.ts`, `notification-state.ts`,
`notification-center.*`, `platform-operations.service.ts`, `business-audit.ts`,
el panel de plataforma, los servicios de configuración y reservas, las rutas,
`firestore.rules` y el índice de solicitudes por negocio y fecha de creación.
