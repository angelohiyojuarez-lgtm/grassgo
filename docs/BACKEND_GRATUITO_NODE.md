# Backend Node para mantener Firebase Spark

## Estado real

Se preparó y probó un servidor Node independiente de Cloud Functions. No está desplegado en internet: falta la cuenta de Render y conectar el repositorio y sus secretos. No se activó facturación Firebase ni se configuró una URL inexistente. La web pública conserva su conexión anterior mientras `public/assets/backend.json` tiene `apiBaseUrl: null`; por eso el error de reservas online todavía no queda resuelto.

El usuario autorizó preparar la alternativa, confirmó que no tiene cuenta en Render y quiere mantener el plan gratuito. El proyecto no tiene un repositorio Git configurado; no se publicó su código en una cuenta externa ni se creó una cuenta por el usuario.

## Implementación

- `functions/server.js`: servidor HTTP Node con lista de funciones permitidas, verificación de tokens Firebase y revocación, límites de solicitud, CORS por origen y errores sin detalles internos. Las operaciones usan las mismas funciones `run` y las mismas comprobaciones de rol/tenant y transacciones existentes.
- `functions/private-media.js`: alternativa privada para imágenes y comprobantes del piloto en documentos Firestore por bloques. Máximo 5 MB, validación de MIME/firma, subida inmutable e idempotente. Los documentos `private_media` no son accesibles por las reglas del navegador. La API comprueba titular o administrador del local para comprobantes, y superadmin para subir fotos/QR. No se usa disco efímero del alojamiento.
- `functions/index.js`: reutiliza la aplicación Admin inicializada por el servidor y selecciona el almacenamiento alternativo solo con `MEDIA_DRIVER=firestore`, que configura el servidor. Conserva la ruta original de Cloud Functions y emuladores.
- `src/app/core/services/backend-transport.service.ts`: selecciona el servidor configurado en `/assets/backend.json`, exige HTTPS fuera de emuladores y adjunta el token solo a ese servidor. Reserva, imágenes y lectura de comprobantes administrativos soportan ambas rutas.
- `render.yaml`: servicio de tipo Node y plan `free`, health check `/health`, raíz `functions` y secreto pendiente. `functions/.env.example` documenta nombres sin claves.

Este almacenamiento de archivos es una solución acotada al piloto para evitar Firebase Storage/Blaze. Consume espacio y lecturas/escrituras de Firestore: no representa almacenamiento ilimitado ni una solución de medios optimizada para muchos negocios. Al alcanzar las cuotas gratuitas el servicio puede dejar de operar; Spark no se cambió a pago por uso.

Render documenta su oferta y sus límites en https://render.com/docs/free. Las instancias gratuitas pueden suspenderse tras inactividad y el primer acceso puede tardar en arrancar. No es una promesa de servicio continuo para una operación comercial.

## Validación ejecutada

- 33 pruebas Angular correctas, incluidas configuración del transporte, no enviar credenciales por HTTP y propagación de errores.
- 81 pruebas existentes de reglas y APIs correctas con `npm run test:integration`.
- 9 pruebas nuevas de HTTP y archivos correctas: token falso, identidad inyectada, CORS, helpers no publicados, entradas inválidas, persistencia, reintentos, archivos inválidos e aislamiento entre clientes y administradores.
- Servidor Node arrancado en `localhost:3001` con Auth y Firestore emulados. Llamada autenticada real a `/api/listPublishedBusinesses` devolvió `el-puma / Grass El Puma`.
- Compilación Angular correcta; permanece la advertencia previa de presupuesto inicial (501,21 kB).

## Publicación pendiente

1. Crear/iniciar sesión en https://dashboard.render.com. El usuario realiza el alta y la aceptación de términos.
2. Conectar un repositorio que contenga este código. No incluir `.firebase`, dependencias, archivos `.env` ni credenciales. La configuración `render.yaml` apunta al backend de `functions`.
3. Preparar una cuenta de servicio dedicada de `grassgoo` con los permisos necesarios de datos Firestore y lectura de usuarios Auth, evitando Owner/Editor. Configurar su JSON solo en el secreto `GOOGLE_SERVICE_ACCOUNT_JSON` del servidor. No pegarlo en el chat ni en código Angular. Nunca usar la sesión personal de Firebase CLI como credencial del servidor.
4. Desplegar el servicio en el plan Free y verificar `/health`, rechazo de sesión falsa y una operación autenticada antes de cambiar el frontend.
5. Colocar la URL HTTPS real del servicio en `public/assets/backend.json` y publicar Hosting.
6. Configurar roles y negocios de producción con un mecanismo administrativo seguro. Las cuentas y registros del emulador no se migraron. El Puma requiere datos reales o definir un entorno de prueba remoto separado: el backend de producción sigue rechazando QR de demostración.
7. Verificar de extremo a extremo creación concurrente, subida privada, revisión manual, inicio real y calificación antes de aceptar pagos reales.

## Windows y siguiente paso

Frontend:

```powershell
npm run build
npm test -- --watch=false
```

Backend y pruebas con los emuladores locales ya iniciados:

```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
node --test --test-concurrency=1 functions/tests/http-server.test.mjs functions/tests/private-media.test.mjs
```

No ejecutar esas pruebas contra producción. Siguiente paso indispensable: disponer de la cuenta de Render y un repositorio conectado para publicar el servidor preparado; hasta entonces no afirmar que las reservas online están reparadas.
