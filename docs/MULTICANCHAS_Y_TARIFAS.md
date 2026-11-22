# Varias canchas y tarifas compartidas

El alta admite de una a veinte canchas dentro del mismo establecimiento. Cada
ficha tiene nombre, deporte, superficie y precios por hora de día y de noche.
Se pueden combinar fútbol, vóley y las otras opciones del formulario. Los
importes y el inicio de la tarifa nocturna se introducen explícitamente, sin
inventar montos ni horarios. Para una tarifa única, se repite el mismo importe.

## Desde el superadmin

1. Abrir **Agregar negocio** y completar los datos del negocio y su dueño.
2. En **Canchas y precios**, completar la primera ficha y usar **+ Añadir otra
   cancha** para fútbol, vóley u otra cancha del establecimiento.
3. Crear el negocio. Queda en preparación hasta completar los horarios, dueño
   y datos reales de pago, y confirmar su publicación.
4. Para ampliar un negocio existente, abrir **Negocios → Ver ficha → + Añadir
   cancha**. Se introduce el deporte y sus tarifas en el mismo formulario.
5. Para modificar importes, usar **Editar precios por cancha**. Se reutiliza el
   mismo editor y servicio que utiliza el dueño.

**Quitar borrador** solamente retira una ficha todavía sin guardar. Al comenzar
el registro se conservan los identificadores y se bloquean cambios del intento
para que un reintento pueda completar las canchas sin duplicar las guardadas.
No se incluye eliminación de canchas persistidas ni de sus reservas.

## Desde el dueño y el cliente

El dueño continúa en **Mi local → Precios por cancha**. Cada cancha aparece con
su nombre, deporte y sus propias tarifas. Los cambios de dueño y superadmin
usan las mismas versiones y escrituras protegidas.

El cliente ve los deportes y precios de cada cancha en el catálogo que ya se
actualiza en vivo. Cada reserva utiliza el identificador de su cancha: reservar
fútbol no bloquea el vóley. Las reservas anteriores conservan su importe.
Cambiar precios no modifica adelantos, comprobantes, estados de publicación ni
partidos. El precio nuevo debe cubrir el adelanto que ya tiene el negocio.

## Persistencia y autorización

Se crea primero el negocio con su ficha en borrador, invitación y auditoría.
Después se guarda cada cancha mediante una transacción de seis escrituras:
cancha privada, proyección pública, precios canónicos, índice del catálogo,
historial y auditoría. Así se conservan las garantías atómicas por cancha sin
acumular todas las canchas en una transacción que exceda los límites de reglas.

Los cambios de tarifas mantienen sincronizadas las mismas proyecciones. Cada
entrada del catálogo recibe `pricingRevision` y `pricingConfirmed: true` cuando
se valida su revisión canónica. Los tiempos de servidor permanecen en los
documentos y auditorías; no se usan transformaciones de timestamp dentro de
arrays, que el SDK no admite. La publicación comprueba todas las canchas y sus
revisiones, además de los requisitos existentes del dueño, horarios y QR.

El superadmin activo puede añadir canchas y modificar tarifas. El dueño sigue
limitado a las canchas de sus establecimientos activos. La ampliación de
permisos afecta solamente a precios; no concede cambios de roles, pagos,
horarios, sesiones ni reservas ajenas. Todos los cambios quedan registrados.

## Windows

Validación de esta entrega: **10 casos focales aprobados** (seis de Angular y
cuatro de reglas en emulador), incluida la publicación de veinte canchas,
rechazo de una tarifa sin confirmar en la última cancha y edición de su precio.
La compilación de producción termina correctamente; conserva los avisos de
tamaño del bundle inicial y de los estilos del panel local.

No se registraron canchas ni tarifas ficticias en la base de producción. Las
canchas reales y sus importes se introducen desde el panel.

La revisión visual corrigió el contraste de las etiquetas y aseguró botones
grandes en el formulario y en el editor reutilizado del superadmin. Las reglas
y la aplicación están desplegadas en `https://grassgo.web.app`.

```powershell
# Seis casos Angular y cuatro de reglas; mantiene la validación focal de 10 casos.
npm run test:multicourt
npm run build
Start-Process 'https://grassgo.web.app/superadmin/negocios'
```

Archivos principales: alta `platform-onboarding.*`, formulario compartido
`platform-court-editor.*`, servicio `platform-onboarding.service.ts`, editor
`admin-local-pricing.*`, `establishment-pricing.service.ts`, ficha y preparación
del superadmin, reglas de Firestore y pruebas focales de multicanchas.
