# Superadministración: escritorio y alta de negocios

**Estado actual en producción:** [Superadmin conectado](SUPERADMIN_CONECTADO.md)
documenta el resumen, las fichas y los cambios de estado con Firestore directo.
El editor y alta descritos debajo pertenecen al backend anterior; todavía no
están disponibles en el modo directo de producción.

Actualización posterior: [alta operativa de negocios](ALTA_NEGOCIOS_OPERATIVA.md) amplía el registro con horarios, canchas, imágenes, pagos, administrador y publicación. Las limitaciones de alta básica descritas debajo corresponden a la primera entrega.

El centro de control tiene un diseño orientado a laptop, con menú lateral propio. Las pantallas de cliente y del administrador del local conservan su recorrido.

## Secciones disponibles

- `/superadmin/inicio`: resumen de los negocios cargados, estados y pasos de incorporación. No inventa cifras de ingresos, usuarios o reservas globales.
- `/superadmin/negocios`: directorio con búsqueda por nombre/ubicación, filtro de estado, ficha, aprobación y suspensión. Se pide confirmar el cambio y se explica su efecto.
- `/superadmin/negocios/nuevo`: nombre y ubicación obligatorios; descripción opcional. Registro real mediante callable protegida.
- `/superadmin/actividad`: últimas 30 acciones de auditoría, solo para superadmin activo, con fechas de Lima.
- `/superadmin/configuracion`: información de sesión y entorno; explica las funciones aún pendientes. No ofrece ajustes ficticios.

La marca, el menú, la recuperación de acceso y el cierre de sesión del superadmin permanecen en `/superadmin/`. No incluyen enlaces al perfil de cliente ni a la administración del local. La identidad Firebase puede tener varios roles, pero cada portal sigue verificando sus permisos.

## Alta segura y alcance

`createEstablishment` comprueba en transacción que el solicitante tiene un rol global activo. Valida campos y longitudes; rechaza campos de privilegios, publicación y políticas enviados por el cliente. Cada intento tiene un identificador estable para evitar duplicados por reintento, y crea una entrada de auditoría en la misma transacción.

El negocio nace en estado `draft`, con `bookingPolicy.enabled: false`. No crea canchas, usuarios, membresías, tarifas, QR ni políticas comerciales. No se publica en el catálogo ni se habilitan reservas. Aprobarlo cambia a `approved`, que tampoco equivale a publicarlo.

La asignación de administrador, configuración de canchas, imágenes, horarios y publicación se implementarán en la próxima entrega. El marketplace del piloto continúa mostrando El Puma; registrar un borrador no añade automáticamente una tarjeta pública.

El directorio consulta hasta 100 registros por carga y lo informa. La paginación y métricas globales completas quedan para una entrega posterior.

## Probar en Windows

Con los emuladores y la demo ya en marcha, abrir:

http://localhost:4201/superadmin/inicio

Cuenta común local: `equipo@grassgo.test`, contraseña `GrassGoDemo2026!`.

Para iniciar desde cero, en terminales separadas:

```powershell
npm run emulators
```

```powershell
npm run seed:emulators
npm run start:emulators -- --port 4201
```

Validaciones:

```powershell
npm run build
npm test -- --watch=false
# Con Firestore Emulator local ya en marcha:
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
node --test functions/tests/platform-api.test.mjs
```

La suite de plataforma usa exclusivamente el proyecto separado `demo-grassgo-platform-tests`; no borra los datos de la demostración abierta. También puede ejecutarse `npm run test:platform` con los emuladores interactivos detenidos para iniciar uno temporal.

Cambios principales: `features/platform/`, `src/platform.css`, rutas y shell de Angular, enlaces de acceso, `functions/booking-api.js`, `functions/index.js` y pruebas de plataforma. No se despliega nada al Firebase remoto en esta entrega.

Validación realizada: compilación de producción correcta, 12 pruebas Angular y 6 pruebas nuevas de backend aprobadas. En navegador se verificaron el formulario obligatorio, alta persistente, mensaje de éxito, ficha, búsqueda, filtro y auditoría. Los registros temporales creados para esa comprobación se retiraron sin modificar El Puma.
