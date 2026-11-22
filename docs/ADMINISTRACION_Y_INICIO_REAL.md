# Administración del local e inicio real

Entrega local del 23 de octubre de 2026. Angular y Firebase conservados. No se ha desplegado a Firebase remoto.

## Qué puede hacer el administrador

- Entrar por `/admin/ingresar` y trabajar en `/admin/inicio`, exclusivamente en sus establecimientos activos.
- Consultar la agenda por fecha, cancha y estado; ver contadores de reservas, partidos en juego, comprobantes de la fecha y partidos finalizados.
- Revisar el comprobante privado y declarar el ingreso realmente verificado del adelanto. El adelanto sigue siendo S/ 10 para todos los negocios.
- Registrar **Ya inició · registrar hora** cuando llegue la hora reservada de una reserva confirmada; después **Finalizar partido** cuando la cancha quede libre.
- Cerrar o reabrir una cancha para nuevas solicitudes mediante mantenimiento. Las reservas ya existentes siguen vigentes y visibles.
- Editar teléfono público, referencia, descripción, días y horario común de atención, tarifa diurna y nocturna de cada cancha y comienzo de la tarifa nocturna.
- Consultar las condiciones de pago vigentes. Portadas, galerías, nuevas canchas, QR, titular y asignación de administradores siguen en el editor de superadministración existente.

## Regla acordada con el usuario

Cada partido dispone de **60 minutos completos a partir del inicio real**. Por ejemplo, una reserva de 20:00–21:00 iniciada a las 20:20 tiene término estimado 21:20. La siguiente reserva de 21:00–22:00 muestra estimación 21:20–22:20.

El horario contratado y los precios originales permanecen como historial. Las estimaciones se calculan en el servidor y se muestran junto al horario reservado. No constituyen un inicio automático: el administrador registra cada inicio y finalización efectivos. Al finalizar antes o después de lo previsto, la proyección vuelve a calcularse. Una finalización puede registrarse antes de los 60 minutos si el partido realmente acabó; no genera ajustes de cobro.

Si la cancha continúa en juego después de su término estimado, la agenda informa que espera confirmación de término y bloquea nuevas solicitudes hasta que el administrador la libere. No se libera automáticamente una cancha que todavía se declaró ocupada.

Las pantallas abiertas de agenda, Inicio del cliente, Mis reservas y selección/confirmación de horario consultan cambios cada **10 segundos**, mientras la pestaña está visible. No se implementaron notificaciones por WhatsApp, correo o push. Un fallo de sincronización se comunica; el servidor vuelve a validar cada escritura. Si un horario seleccionado deja de estar disponible, el cliente vuelve a la selección.

## Integridad y aislamiento

- Las funciones `recordSession`, `setCourtMaintenance`, `getAdminSettings` y `saveAdminSettings` comprueban membresía canónica activa y estado del local en servidor. Las mutaciones revalidan dentro de transacciones.
- El inicio usa el reloj del servidor; rechaza horas enviadas desde el navegador, reservas no confirmadas, otra fecha, inicio anticipado o una reserva anterior pendiente. Solo admite un partido en juego por cancha.
- Reintentar inicio/finalización no cambia la hora original ni duplica eventos. Cada transición registra autor y auditoría; no crea pagos adicionales.
- `courts.runtime` mantiene el partido en juego, fecha, inicio real y término estimado; `lastEndedAt` conserva la última liberación, incluido el cruce de medianoche. La disponibilidad y la creación leen el mismo estado de cancha para coordinar concurrencia.
- La agenda pública devuelve solo horarios y estado operativo, sin identidad ni identificador de reservas ajenas.
- Los cambios de configuración usan `businessRevision`, campos permitidos y validaciones. No permiten modificar roles, titular/QR o adelanto desde este formulario.
- Un cambio de días/horas se rechaza si deja reservas confirmadas o retenciones activas fuera de atención. Las tarifas nuevas no cambian precios históricos.
- La republicación por superadmin conserva mantenimiento y partido activo; no permite retirar una cancha en juego.
- Las reglas Firestore existentes mantienen denegadas las escrituras directas a reservas/canchas/roles. Se añadieron índices para consultas de reservas por cliente/creación y establecimiento/fecha. Su despliegue remoto está pendiente junto con las funciones.

## Archivos principales

- `functions/operations-api.js`: operaciones administrativas y configuración limitada al tenant.
- `functions/court-schedule.js`: proyección compartida de horarios y detección de cruces.
- `functions/booking-api.js`, `functions/index.js`, `functions/business-api.js`: disponibilidad, reservas propias, agenda por fecha, funciones callable y conservación del estado operativo al republicar.
- `src/app/features/staff/staff-dashboard.ts` y `.html`: panel, filtros, contadores, inicio/finalización y mantenimiento.
- `src/app/features/staff/admin-settings.ts`: formulario de configuración del local.
- `src/app/shared/reservation-timing.ts`: mensajes de inicio/retraso/finalización para el cliente.
- `src/app/features/booking/{booking-flow,my-reservations,customer-home}.ts`, `booking-flow.html`, modelos de reserva y servicio: actualización automática y horarios operativos.
- `src/platform.css`: panel adaptable a computadora y celular; `firestore.indexes.json`: índices; `package.json`: comandos de pruebas.
- `functions/tests/operations-api.test.mjs`, `booking-api.test.mjs`, `src/app/features/booking/booking-flow.spec.ts`: regresión y aislamiento. Las pruebas de reservas ahora usan un proyecto de emulador independiente del entorno interactivo.

## Verificación realizada

- `npm run build`: compilación de producción correcta, sin advertencias de presupuesto.
- `npm test -- --watch=false`: **19 pruebas Angular aprobadas**.
- Reservas + alta de negocios + operaciones contra Firestore Emulator: **42 pruebas aprobadas**. Incluyen permisos ajenos/revocados, hora del servidor, inicio simultáneo, reintentos, retrasos encadenados, precios históricos, mantenimiento, medianoche y configuración con versión antigua.
- Navegador con un local temporal: inicio real 13:38 → término 14:38; siguiente partido estimado 14:38–15:38. Se comprobó el mismo aviso en Mis reservas, guardado/reapertura de la referencia del local, finalización y actualización automática del cliente, sin errores de consola.
- El local y las reservas temporales de QA se eliminaron al terminar; no se modificaron los negocios existentes para estas pruebas.
- Se reparó en el emulador el índice de navegación de `equipo-demo` hacia El Puma, validando primero que su membresía canónica ya era administrador activo. No se concedió un rol nuevo ni se publicó el negocio.

## Comandos de Windows

Si los emuladores y Angular ya están activos, abrir `http://localhost:4201/admin/inicio`.

Desde PowerShell en la raíz del proyecto, para arrancar en dos terminales:

```powershell
npm run emulators -- --import .firebase/demo-safe --export-on-exit .firebase/demo-safe
```

```powershell
npm run start:emulators -- --port 4201
```

Para verificar con el emulador Firestore ya activo:

```powershell
npm run build
npm test -- --watch=false
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
node --test --test-concurrency=1 functions/tests/operations-api.test.mjs functions/tests/booking-api.test.mjs functions/tests/business-api.test.mjs
```

`npm run test:operations` inicia un Firestore de pruebas en el puerto de `firebase.test.json` (8085). No inicia un segundo Storage Emulator. La suite completa `test:integration` sí usa Storage: evitar ejecutarla simultáneamente con el Storage interactivo en este equipo.

La prueba visual reproducible usa `node scripts/qa-operations.mjs setup`, `verify` y `cleanup`. Solo crea/elimina su propio fixture señalado `qaOperations: true` dentro de `demo-grassgo` en loopback. No ejecutarla para producir datos de un negocio real.

## Límites y siguiente paso

Los horarios de atención siguen siendo comunes a los días seleccionados, en bloques de una hora y sin ventanas que crucen medianoche. Un partido iniciado tarde puede terminar después de medianoche y se conserva su ocupación. Las fotos y datos de cobro continúan en superadmin. La bandeja personal consulta las últimas 100 reservas, ahora ordenadas por creación; la agenda administrativa consulta toda la fecha elegida.

Una reserva confirmada anterior que no llegó a jugar requiere definir la política de ausencia/cancelación antes de permitir saltarla: no se cancela ni reembolsa automáticamente. Quiosco, saldo final, caja y reportes financieros completos siguen pendientes. El siguiente paso recomendado es probar la operación de un día con el negocio configurado y definir el tratamiento de ausencias y cancelaciones.
