# GrassGo — Recorrido móvil blanco y celeste

Última entrega: [Alta operativa de negocios](ALTA_NEGOCIOS_OPERATIVA.md). El catálogo ya carga locales publicados y canchas reales; el propietario confirmó S/ 10 de adelanto para todos los negocios.

Actualización: el superadmin tiene ahora un escritorio propio y alta de negocios como borradores. Ver [SUPERADMIN_NEGOCIOS.md](SUPERADMIN_NEGOCIOS.md) para rutas, alcance y validación de esta entrega.

## Decisiones confirmadas por el propietario

- Color principal `#0cb7f2`, blanco, difuminados y tarjeta translúcida inspirada en la referencia.
- La dirección inicial abre el login. Tras entrar se abre el home, con reservas y un botón grande Ver canchas.
- Actualmente se presenta solamente Grass El Puma y su única cancha de fútbol.
- La foto funciona como botón. No se atribuyen formatos como fútbol 7 ni equipamiento no confirmado.
- Selección secuencial de fecha, bloque de una hora y revisión de solicitud.
- Tarifa del piloto: S/ 30 antes de las 18:00; S/ 40 desde las 18:00. Adelanto S/ 10.
- El QR es de demostración y codifica `GRASSGO-DEMO-NO-REALIZAR-PAGOS`: no contiene un destinatario de pago.
- Se adjunta un comprobante de pago; subirlo no equivale a verificar dinero recibido.

## Direcciones

| Área                             | Entrada                | Después de entrar    |
| -------------------------------- | ---------------------- | -------------------- |
| Cliente                          | `/` → `/ingresar`      | `/inicio`            |
| Administrador de establecimiento | `/admin/ingresar`      | `/admin/inicio`      |
| Superadministrador               | `/superadmin/ingresar` | `/superadmin/inicio` |

Las tres entradas usan la misma identidad Firebase Authentication. Cada entrada administrativa comprueba sus permisos. No existen registros públicos de administradores ni campos del perfil para convertirse en superadmin.

## Qué funciona en el entorno local de pruebas

1. Acceso → home → Ver canchas → El Puma → foto de su cancha → calendario → horarios → revisión.
2. Creación de solicitud por Cloud Functions, cálculo del precio en servidor, comprobación del horario y ocupación transaccional. Dos solicitudes simultáneas no pueden retener el mismo bloque.
3. Reintentos con identificador de solicitud estable sin duplicación.
4. Solicitud `pending_payment` → subida privada del comprobante → `pending_verification` / pago `submitted`.
5. El administrador revisa el archivo privado y declara que verificó el ingreso real de S/ 10. Solo entonces se cambia a `confirmed` / pago `verified` y se registra un único movimiento de adelanto.
6. Cada cliente consulta sus propias solicitudes; puede retomar la carga de comprobante desde Mis reservas.
7. El administrador consulta reservas y canchas de sus locales asignados. El superadmin consulta establecimientos y puede aprobar/suspender, con auditoría.

El superadmin también registra negocios como borradores, busca y filtra negocios y consulta actividad. El quiosco, la edición de canchas, las cancelaciones/devoluciones, altas de administradores y los planes siguen siendo etapas posteriores. No hay reembolsos ni pagos automáticos.

## Protección de datos y límites

- Las reglas Firestore existentes mantienen bloqueadas las escrituras cliente a reservas, pagos, roles, ocupación y auditoría.
- Las funciones usan Admin SDK: por ello validan explícitamente el UID autenticado, membresía canónica activa y rol global según la operación.
- Storage admite un solo comprobante inmutable por solicitud propia, pendiente y vigente. JPG/PNG/WebP de hasta 5 MB; solo titular y administrador activo del local pueden leerlo.
- El servidor verifica tamaño, MIME y firma binaria antes de aceptar el envío. El administrador consulta mediante descarga autenticada, sin publicar una URL permanente en la interfaz.
- El pago demo se rechaza en funciones fuera del emulador. El sitio real no debe activar cobros con el QR de ejemplo.
- Hay un límite técnico de 20 solicitudes por usuario y fecha para reducir abuso. Es independiente del plazo de retención configurado por local.
- Son reglas y funciones prototipo; las pruebas no reemplazan una revisión antes de una apertura pública. App Check, monitoreo y límites comerciales se revisarán para el despliegue real.

## Datos que NO se han inventado para producción

Faltan horario de apertura/cierre y plazo de vencimiento de solicitudes, foto auténtica y datos de pago del propietario. Las fotos actuales están identificadas como referenciales.

El seed local usa apertura 08:00, cierre 24:00 y retención de 30 minutos **exclusivamente como datos ficticios de prueba**. No representan reglas comerciales aprobadas de El Puma ni se publicaron en el proyecto real.

Si no se puede consultar una agenda configurada, la interfaz permite recorrer bloques claramente marcados como ejemplos y bloquea la creación de solicitudes reales. No presenta esos bloques como disponibilidad verificada.

## Windows: ejecutar y probar

Vista con la configuración Firebase existente:

```powershell
npm install
npm install --prefix functions
npm start
```

Abrir http://localhost:4200/. El nuevo backend y las reglas no se han desplegado a Firebase remoto: la activación requiere revisar su edición/configuración, credenciales de despliegue y los datos pendientes.

Demostración completa aislada, sin dinero ni usuarios reales:

```powershell
# Terminal 1: Java 21+; el wrapper también detecta el JRE portátil local.
npm run emulators
# Terminal 2: después de que los emuladores estén listos.
npm run seed:emulators
npm run start:emulators -- --port 4201
```

En http://localhost:4201/:

**Cuenta común para los tres apartados:** `equipo@grassgo.test` / `GrassGoDemo2026!`.
Tiene membresía administrativa de El Puma y rol superadmin asignados por el seed local.
Entradas: `/ingresar`, `/admin/ingresar` y `/superadmin/ingresar`.
No se crea esta cuenta ni se cambian permisos en Firebase remoto.

También se conservan las cuentas separadas para probar los límites de cada rol:

| Rol           | Correo ficticio           | Contraseña de prueba |
| ------------- | ------------------------- | -------------------- |
| Cliente       | `cliente@grassgo.test`    | `GrassGoDemo2026!`   |
| Administrador | `admin@grassgo.test`      | `GrassGoDemo2026!`   |
| Superadmin    | `superadmin@grassgo.test` | `GrassGoDemo2026!`   |

Los datos son temporales. El seed está fijado a servicios locales y al proyecto `demo-grassgo` para impedir que escriba en producción.

Funciones declaran Node 22. Esta máquina usa Node 24; el emulador ejecutó las pruebas con ese runtime local. Usar Node 22 para verificar el entorno exacto antes de desplegar.

## Validación

```powershell
npm run build
npm test -- --watch=false
# Detener emuladores interactivos antes de ejecutar las dos suites siguientes.
npm run test:rules
npm run test:backend
# Con los cuatro emuladores en marcha y seed preparado:
node scripts/smoke-booking.mjs
```

- 12 pruebas Angular: identidad, guardas, calendario, zona horaria y tarifas.
- 22 escenarios de reglas: 16 Firestore y 6 Storage.
- 12 pruebas backend: concurrencia, idempotencia, precios del servidor, aislamiento, comprobante, pago, vencimiento y superadmin.
- Smoke completo con los SDK reales y los cuatro emuladores: Auth → Functions → Storage privado → revisión admin → confirmación.
- Revisión visual en escritorio y marcos móviles de 320 y 390 px.
- Auditorías sin vulnerabilidades de producción tanto en raíz como en functions/ al cierre del cambio. Permanecen avisos moderados de herramientas Firebase de desarrollo en raíz.

## Archivos principales

`src/cyan.css`, `src/app/app.routes.ts`, `features/auth/`, `features/booking/`, `features/staff/`, `core/services/booking.service.ts`, `functions/`, `storage.rules`, `firebase.json`, scripts de emuladores y pruebas. Los archivos anteriores sobrescritos tienen respaldo local en `legacy/pre-cyan-redesign/`.

## Siguiente paso

Validar el aspecto con el propietario y completar horario de atención y retención; sustituir foto/QR de ejemplo. Revisar y activar el backend en Firebase real en una entrega separada. No se cambia monetización, política de cancelación ni reembolsos sin definirlos.
