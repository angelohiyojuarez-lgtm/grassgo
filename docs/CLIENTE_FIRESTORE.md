# Recorrido del cliente — 19 de noviembre de 2026

Angular y Firebase se conservan. El cliente utiliza Firestore Standard directamente,
con validación efectiva en Security Rules; no requiere Cloud Functions, Render ni
una pasarela de pagos para solicitar una reserva y adjuntar la foto del comprobante.

## Qué cubre este incremento

- Catálogo publicado, selección de cancha/fecha y consulta de horarios reales.
- Solicitud y bloqueo horario creados en una transacción: dos clientes no pueden
  obtener el mismo bloque. Reintentar el mismo identificador no duplica solicitudes.
- Retención de 15 minutos, limitada además por el inicio del partido, según la
  decisión registrada en `FIRESTORE_SIN_RENDER.md`.
- Límite técnico de 20 solicitudes por cliente y fecha, conservado del backend
  anterior; contador privado, transaccional y sin reinicio desde el navegador.
- Foto de hasta 5 MB, decodificada y convertida a JPEG de hasta 450 KiB antes de
  guardarla en un documento privado de Firestore. Se evita depender de Storage
  para este recorrido en Spark. La foto se optimiza: comprobar su legibilidad.
- Comprobante y cambio a `pending_verification` se guardan juntos. La foto no
  verifica el pago. Solo el administrador canónico del establecimiento puede
  declarar el ingreso real y confirmar, o rechazar y liberar el horario.
- Recuperación de la solicitud mediante la URL, instrucciones de pago conservadas
  al crearla, vencimiento visible e historial propio actualizado cada 10 segundos.
- Fallos de conexión no generan horarios de ejemplo ni borran el historial visible.

## Datos y permisos

| Ruta | Contenido y acceso |
| --- | --- |
| `catalog/{local}` | Ficha publicada e instrucciones públicas del local; sesión requerida. |
| `catalog/{local}/courts/{cancha}` | Proyección pública de horario y tarifas; sesión requerida. |
| `establishments/{local}` y canchas | Configuración canónica privada; las reglas la comprueban al crear. |
| `direct_requests/{id}` | Solicitud privada; cliente propietario o administrador canónico del local. |
| `direct_slots/{local}/courts/{cancha}/days/{fecha}/hours/{hora}` | Disponibilidad sin identidad ni foto. |
| `direct_proofs/{id}` | JPEG privado e inmutable; propietario y administrador canónico del local. |
| `direct_limits/{uid}/days/{fecha}` | Contador privado de creación; solo puede aumentar junto a una solicitud nueva. |

Las escrituras del catálogo, configuración, membresías y privilegios siguen
reservadas al mecanismo administrativo seguro. El navegador no puede asignarse
roles. Las pruebas incluyen cliente ajeno y administrador de otro establecimiento.
Las reglas comprueban formato/tamaño del comprobante; su autenticidad y el ingreso
del dinero requieren revisión humana.

La publicación operativa requiere `bookingEngine: 'direct'` en el establecimiento,
`booking.enabled: true` y `booking.engine: 'direct'` en el catálogo, horario y tarifas
canónicas, proyección pública y datos de pago válidos. El backend anterior rechaza
crear ocupaciones para un local que ya usa el motor directo. No cambiar un negocio
con reservas anteriores sin preparar y validar su migración.

## Estado real de El Puma

El usuario confirmó atención **todos los días**. Todavía no proporcionó horas de
apertura/cierre, método/número/titular del adelanto. No se inventaron esos datos.
La ficha remota sigue siendo de demostración y las reservas reales permanecen
pausadas. No se crearon cuentas, administradores ni reservas de producción.

La siguiente etapa del administrador debe proporcionar la configuración segura,
asignación del responsable y sincronización de la proyección pública. Inicio real,
finalización, mantenimiento y calificaciones del motor anterior requieren su
adaptación al motor directo. No se presentan como terminados en este incremento.
Cancelaciones, ausencias y devoluciones requieren decisiones del negocio.

## Probar en Windows sin tocar producción

Desde la raíz, con dependencias instaladas en raíz y `functions/`:

```powershell
# Terminal 1: el wrapper detecta el Java portable preparado en este equipo.
node scripts/firebase-local.mjs emulators:start --project demo-grassgo --only auth,firestore
```

```powershell
# Terminal 2, cuando los emuladores indiquen que están listos:
npm run seed:direct-emulators
npm run start:direct-emulators -- --port 4201
```

Abrir `http://127.0.0.1:4201/`. El fixture aislado `direct-demo` no modifica El Puma.
Cliente: `cliente.directo@grassgo.test`; administrador: `admin.directo@grassgo.test`.
Contraseña DEMO de ambos: `GrassGoDirectDemo2026!`. No hacer pagos.
Para probar ambas sesiones simultáneamente, usar `127.0.0.1` para cliente y
`localhost` para administrador. El seed no borra reservas anteriores de prueba.

```powershell
npm run build
npm test -- --watch=false
npm run test:direct
npm run test:integration
```

Los dos últimos comandos se ejecutan uno después del otro: comparten los puertos
de pruebas 8085/9195. La suite completa incluye ahora reglas directas, archivos
privados y servidor HTTP, además de las regresiones anteriores.

`npm start` utiliza Firebase real. Para una demostración aislada usar siempre
`start:direct-emulators`. El modo anterior `start:emulators` se conserva para
verificar operaciones históricas por Functions en los emuladores.

## Publicar este incremento

Validación de esta entrega: compilación de producción correcta (advertencia previa
de presupuesto inicial: 501,23 kB frente a 500 kB), **64 pruebas Angular** y
**113 pruebas de integración** aprobadas. Dentro de la suite hay 22 casos de reglas
directas con concurrencia, aislamiento, cuota y transiciones. Se verificó en el
navegador el recorrido del fixture: login del cliente, horario real, creación,
foto, revisión desde otra sesión administrativa y confirmación visible al cliente.
No se hicieron pagos ni se crearon registros de producción para esta prueba.

Archivos del incremento:

- Servicios nuevos `direct-booking.service.ts`, `receipt-image.ts` y sus pruebas;
  adaptación de `booking.service.ts`, `business-catalog.service.ts` y modelo `booking.ts`.
- `features/booking/booking-flow.{ts,html,spec.ts}`, `my-reservations.ts` y su prueba;
  puente mínimo de revisión en `features/staff/staff-dashboard.{ts,html}`.
- `firestore.rules`, `firestore.indexes.json`, `tests/direct-reservations.rules.test.mjs`;
  guardia contra doble motor en `functions/booking-api.js` y su regresión.
- Entornos `environment.ts`, `environment.prod.ts`, `environment.emulators.ts` y
  nuevo `environment.direct-emulators.ts`; `angular.json`, `package.json` y
  `scripts/seed-direct-emulators.mjs`.
- `README.md`, `FIRESTORE_SIN_RENDER.md` y este documento.

Solo después de las pruebas y la revisión de las reglas:

```powershell
npm run build
node scripts/firebase-local.mjs deploy --only firestore:rules,firestore:indexes,hosting --project grassgoo --non-interactive
```

No publica Functions, no activa facturación ni copia el seed a producción. Los
negocios sin configuración operativa válida continúan sin aceptar solicitudes.

Publicación realizada en `https://grassgo.web.app`: Hosting, reglas e índices
liberados correctamente. Los dos índices de `direct_requests` fueron comprobados
en estado `READY`. Las rutas de acceso, reservas y canchas respondieron HTTP 200
con el mismo bundle final que la compilación local. Se verificó que El Puma
continúa en modo demostración, sin horario configurado y sin reservas reales
habilitadas. Esta verificación remota no creó cuentas ni solicitudes.

Las reglas son un prototipo validado con los escenarios de este incremento y
requieren revisión antes de una difusión amplia:

> I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for atomic slot holds, private immutable receipts, strict request validation and tenant-scoped manual verification. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.
