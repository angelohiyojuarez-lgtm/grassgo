# Mi local: horarios y fechas cerradas

Incremento del 19 de noviembre de 2026. Se mantienen Angular 22 y Firebase;
funciona con Firestore directo, sin nuevas Cloud Functions ni servicios de pago.

## Cómo usarlo

Entrar en **Administración → Mi local → Horarios y cierres**. Hay tres bloques grandes:

1. **Tu horario habitual:** encender los días de atención, elegir apertura y
   cierre, revisar el resumen y pulsar **Guardar horario**. Los días apagados
   quedan cerrados. **Todos los días** facilita la selección inicial.
2. **Cerrar una fecha específica:** elegir fecha, escribir un motivo interno
   opcional y pulsar **Revisar cierre**. Revisar el aviso y confirmar.
3. **Tus próximas fechas cerradas:** consultar cierres próximos y pulsar
   **Quitar cierre** para volver al horario habitual. Requiere confirmación;
   quitar un cierre especial no abre un día que está cerrado semanalmente.

Los cambios afectan solamente a **nuevas solicitudes**. Las solicitudes y
reservas existentes se conservan y deben atenderse; no se cancelan, desplazan
ni cambian sus importes. El motivo del cierre queda privado al establecimiento.

El horario semanal se aplica a todas las canchas. Esta primera versión usa
horas completas y una franja común por día; 24:00 significa medianoche.
Franjas partidas, horarios distintos por día o atención pasada la medianoche
quedan para incrementos posteriores, si se necesitan.

Los controles miden al menos 56 px; los principales, 62 px. Texto de controles
17–18 px. Hay estados escritos Abierto/Cerrado y confirmaciones de cierres.
Se protege la edición pendiente al cambiar de pestaña/local, navegar, salir
o recargar; mientras guarda se impide abandonar el formulario.

**El Puma:** no se publicaron horas inventadas. El propietario debe elegir sus
horas reales en esta pantalla. Guardar el horario no activa automáticamente
reservas ni completa canchas o datos de pago que aún falten.

## Datos y autorización

- Semana canónica: `establishments/{id}/settings/schedule`. Días únicos 0–6,
  apertura 0–23, cierre 1–24 posterior a apertura. Una semana nueva con lista
  vacía significa cerrado; los horarios antiguos conservan su semántica.
- Su proyección actualiza únicamente `days`, `openHour`, `closeHour`,
  `scheduleRevision`, `scheduleUpdatedAt` del documento `catalog/{id}` existente.
  No añade lecturas por cada tarjeta del catálogo.
- Cierres canónicos: `establishments/{id}/closures/{YYYY-MM-DD}`. Proyección
  pública en `catalog/{id}/closures/{fecha}`, sin motivo ni autor.
- Fechas validadas como calendario real y medianoche de Lima (UTC−5).
  Reabrir registra `closed:false`; no borra el documento ni el historial.
- Cada guardado exige tres escrituras atómicas: canónico, proyección e historial
  inmutable `history/{revision}`. La revisión debe aumentar exactamente uno;
  una pantalla antigua no sobrescribe un cambio reciente.
- Las reglas exigen membresía administrativa canónica del mismo local,
  establecimiento activo y motor directo. Un índice de membresías de interfaz
  no concede permisos. Suspendidos y administradores ajenos no pueden editar.
- Las nuevas solicitudes comprueban el horario y cierre canónicos posteriores
  a la operación atómica; ignorar la interfaz no permite reservar un día cerrado.
  El cliente relee la proyección dentro de su transacción para detectar carreras.
- Índice `closures(closed ASC, dateStart ASC)`, desplegado y comprobado READY.
  Se muestran hasta 100 cierres próximos; otra fecha puede consultarse directamente.

## Validación

- Suite Angular completa: **124/124** aprobadas.
- Integración completa: **132/132** aprobadas. Después se añadió un positivo
  del camino con semana, fecha reabierta y sustitución de retención vencida:
  suite horarios+reservas directas **42/42**. La prueba de concurrencia se
  robusteció con límites de tiempo y limpieza; horarios **20/20**.
- Revisión independiente de reglas: sin bypass confirmado de tenant, espejo,
  historial o concurrencia. Se probó el camino de mayor acceso documental.
- Navegador con negocio y cuentas DEMO locales: guardado semanal persistente,
  cierre con confirmación, rechazo de nuevas solicitudes desde el cliente,
  conservación de reserva confirmada y posterior reapertura. Se restableció
  el horario DEMO 08:00–24:00 y se quitó el cierre usado para la prueba.
- Revisión visual en escritorio y a 320 px en temas claro/oscuro: controles de
  al menos 56 px, etiquetas legibles y sin desbordamiento horizontal. Se restauró
  el tema claro y el tamaño normal al terminar.
- Compilación de producción correcta. Advertencias de tamaño: inicial 501,56 kB
  frente al objetivo 500 kB; estilos del panel 7,58 kB y horarios 4,20 kB frente
  al objetivo 4 kB, ambos debajo del máximo 8 kB. No se elevaron presupuestos.
- Firebase compila las reglas; informa advertencias de inferencia `null/map`
  en ramas de documentos ausentes. Las pruebas cubren creación y ausencia de
  configuración, además de documentos existentes.
- Se publicaron Hosting, reglas e índices en `grassgoo`, sitio `grassgo.web.app`.

Nota de la skill de creación de reglas:

> I've set up prototype Security Rules to keep the data in Firestore safe. They
> are designed to be secure for tenant isolation through canonical memberships,
> closed schemas, server timestamps, and atomic configuration, projection and
> history writes. However, you should review and verify them before broadly
> sharing your app. If you'd like, I can help you harden these rules.

## Archivos de este incremento

- `src/app/features/staff/admin-local-schedule.{ts,html,css,spec.ts}`.
- `src/app/features/staff/staff-dashboard.{ts,html,css,spec.ts}` y `app.routes.ts`.
- `src/app/core/models/{establishment-schedule,booking}.ts`.
- `src/app/core/services/establishment-schedule.service.ts` y su prueba.
- `src/app/core/services/{direct-booking,business-catalog}.service.ts` y pruebas.
- `src/app/features/booking/{booking-flow.html,courts.ts}`.
- `firestore.rules`, `firestore.indexes.json`,
  `tests/direct-schedule.rules.test.mjs`, `package.json` y documentación.
- Capturas reales DEMO: `screenshots/horarios-local-escritorio.jpg` y
  `screenshots/horarios-local-movil.jpg`.

## Windows

```powershell
npm start
npm test -- --watch=false
npm run test:schedule
npm run test:integration
npm run build
```

Para probar sin datos reales, preparar los emuladores y el fixture documentados
en `CLIENTE_FIRESTORE.md`; después ejecutar:

```powershell
npm run start:direct-emulators -- --port 4201
```

Actualización posterior: el dueño ya puede completar [contacto y foto del QR](DATOS_Y_QR_DEL_LOCAL.md).
Falta completar canchas y datos operativos reales, conservando la verificación manual del adelanto.
