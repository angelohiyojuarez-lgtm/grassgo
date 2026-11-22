# Horarios actualizados, precios y partidos de una hora

Incremento del 20 de noviembre de 2026. Mantiene Angular 22, Firestore Standard y
el motor directo sin nuevos servicios de pago ni Cloud Functions.

## Qué ve el dueño

- **Mi local → Precios por cancha:** editar precio de día, precio de noche y hora
  a partir de la cual rige la noche. Guardado independiente por cancha, con resumen
  en soles y protección de cambios pendientes. El adelanto se conserva.
- **Revisar comprobantes:** estados escritos **Por validar**, **Validado** y
  **No validado**. Revisar la foto y comprobar el ingreso real antes de pulsar
  **Sí, validar pago y confirmar reserva**. El rechazo requiere confirmación.
  Una imagen no verifica ni cobra dinero automáticamente.
- **Ver mi agenda → Empezar partido:** disponible para reservas confirmadas y
  con adelanto verificado, el día reservado y desde su hora contratada. Una sola
  cancha puede tener un único partido en juego a la vez.
- No hay botón de finalizar: por decisión del usuario, el partido termina
  automáticamente **una hora después de su inicio real**. Si inicia 20:20,
  termina 21:20; el siguiente turno muestra una estimación desde 21:20.
  El siguiente partido sigue requiriendo su propio botón **Empezar partido**.

Se preservan el precio, adelanto, medio de pago y fecha/hora originalmente
contratados. Las estimaciones operativas no reprograman automáticamente reservas.
El dueño elige qué reserva confirmada cuya hora llegó empieza; esta entrega no
impone una política de prioridad o cola global nueva.

## Por qué no se veían los horarios

La ficha y el listado consultaban el catálogo una sola vez. Ahora escuchan cambios
publicados de Firestore; horarios y precios se reflejan con la pantalla abierta.
Las consultas puntuales también solicitan datos del servidor. Se cierran las
escuchas al salir y se descartan respuestas antiguas durante cambios simultáneos.

El calendario deshabilita los días cerrados del horario semanal, informa el cierre
en texto accesible y bloquea confirmar esa fecha. La disponibilidad comprueba
además los cierres especiales por fecha. Una semana nueva sin días seleccionados
significa cerrado; se mantiene la semántica de configuración antigua.

En producción se verificó que El Puma sí había guardado **09:00–24:00, todos los
días**. Su cancha principal solo existía en la presentación del catálogo. Se
conectaron los documentos operativos privados y públicos copiando sus datos y
tarifas existentes: día S/30, noche S/40, noche desde 18:00. No se cambiaron esos
importes, horarios guardados, pagos, roles ni reservas. La habilitación de reservas
del piloto se conservó desactivada; sigue necesitando sus datos operativos reales.

La conexión usa `scripts/connect-pilot-court.mjs`: verifica administrador activo,
revisión y proyección del horario, cancha única e importes válidos. Es atómica con
precondiciones de versión/existencia, guarda copia local previa y auditoría en
`establishments/el-puma/migrations/connect-existing-principal`. Reejecutar no
sobrescribe canchas existentes.

## Autorización y registro

Precios: canónico en `establishments/{id}/courts/{court}/settings/pricing`,
proyecciones privada/pública por cancha y entrada del catálogo, e historial
inmutable. Cinco escrituras atómicas con revisión optimista. Solo cambian las
tres tarifas y sus metadatos; el resto de canchas y la configuración se conservan.
Se mantienen los límites técnicos existentes de S/10 a S/10000 por hora.

Partidos: solicitud, horario público, estado operativo privado/público e historial
se vinculan atómicamente. La hora de inicio usa el reloj del servidor. El fin
autorizado es exactamente `actualStartAt + 1 hora`, conservando la precisión del
timestamp. No se permite anticipar el fin ni enviar un reloj arbitrario.

El vencimiento efectivo se comprueba también en las reglas con `request.time`:
no depende de mantener abierto un navegador ni de ejecutar un contador cliente.
La interfaz deriva el estado finalizado del inicio guardado y actualiza su reloj.
El registro persistido y el historial del cierre se sincronizan en la siguiente
actividad administrativa, conservando como hora final el límite exacto, incluso
si la consulta ocurre después. No se añade un trabajo programado de facturación.

Las estimaciones encadenadas se calculan sobre horarios confirmados y el inicio
real. Son informativas; la autorización protege el horario contratado, el fin
automático y la exclusión de partidos simultáneos, sin afirmar una reprogramación
global de todas las reservas. Precios y horas originales son inmutables al operar.
Los estados públicos no contienen nombre, celular o comprobante del cliente.

## Archivos principales

- `src/app/features/staff/admin-local-pricing.{ts,html,css,spec.ts}`.
- `src/app/core/models/establishment-pricing.ts` y servicio correspondiente.
- `staff-dashboard.{ts,html,css,spec.ts}`: precios, comprobantes e inicio.
- `business-catalog.service` y pantallas `courts`, `venues`, `booking-flow`:
  actualización de catálogo y calendario, con pruebas.
- `direct-booking.service`, `direct-court-schedule`, `booking.service` y pruebas:
  inicio, fin automático y estimaciones.
- `src/app/shared/reservation-timing.{ts,spec.ts}`: finalización visible al cliente.
- `firestore.rules`, pruebas `direct-pricing` y `direct-games`, `package.json`.
- Scripts de conexión del piloto y fixture `qa-live-operations.mjs`; documentación.

## Ejecutar en Windows

Validación final: **230/230 pruebas Angular** y **179/179 de integración**
aprobadas. La suite focal de reglas de precios/partidos/regresiones pasó 88/88,
incluidos concurrencia, límite de accesos, fin H−1/H/H+1, medianoche y expiración
sin un navegador conectado. Revisión independiente sin bypass confirmado.

En el navegador se verificó: S/30→S/35 y S/40→S/45 reflejados sin recargar,
horario 09:00–23:00 con domingo cerrado actualizado en la ficha abierta,
domingo deshabilitado en el calendario y reservas anteriores conservando S/30.
Un fixture que había iniciado una hora antes apareció finalizado al entrar;
el siguiente pudo iniciarse y se conservó el fin exacto de 60 minutos en el
historial. También se confirmó un comprobante ficticio mediante revisión manual.

Escritorio y móvil de 320 px, temas claro/oscuro: sin desbordamiento horizontal y
controles de precios desde 58 px. Capturas DEMO: `screenshots/precios-local-movil.jpg`
y `screenshots/partido-finaliza-automaticamente.jpg`. Se restauró la vista normal.

Compilación y publicación de Hosting/reglas correctas en `grassgo.web.app`.
Continúan advertencias de presupuesto: inicial 501,56 kB frente al objetivo
500 kB; estilos del panel 7,78 kB, horario 4,20 kB y datos 4,00 kB frente al
objetivo 4 kB, todos debajo del máximo 8 kB. No se aumentaron presupuestos.
Las advertencias de inferencia `null/map` del compilador de reglas corresponden
a ramas opcionales cubiertas por las pruebas de ausencia/creación/actualización.

```powershell
npm start
npm test -- --watch=false
npm run test:direct-operations
npm run test:integration
npm run build
```

Fixture solo para Auth9099/Firestore8080 y proyecto `demo-grassgo`, con las cuentas
y negocio marcados como DEMO y sin pagos reales:

```powershell
npm run seed:direct-emulators
node scripts/qa-live-operations.mjs setup
# Alternativa tras limpiar: partido que terminó mientras no se consultaba el panel
node scripts/qa-live-operations.mjs setup-expired
node scripts/qa-live-operations.mjs verify
node scripts/qa-live-operations.mjs cleanup
```

`setup` y `setup-expired` son alternativas y no sobrescriben datos. La limpieza
comprueba marcas, cuentas y pertenencia antes de retirar solamente el fixture.

Nota de revisión antes de apertura amplia, según la skill de reglas:

> I've set up prototype Security Rules to keep the data in Firestore safe. They
> are designed to be secure for canonical tenant membership, strict field
> validation, immutable reservation terms, server timestamps, and atomic
> configuration and session history. However, you should review and verify them
> before broadly sharing your app. If you'd like, I can help you harden these rules.
