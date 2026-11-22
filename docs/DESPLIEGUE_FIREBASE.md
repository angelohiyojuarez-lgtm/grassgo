# Despliegue de GrassGo — 5 de noviembre de 2026

## Resultado

Interfaz publicada en https://grassgo.web.app con Firebase Hosting, proyecto `grassgoo`, sitio `grassgo`. Este sitio está asociado al mismo appId web de la configuración Angular existente. No se modificó el sitio distinto `grassgoo.web.app`.

- Cliente: https://grassgo.web.app/ingresar
- Administrador: https://grassgo.web.app/admin/ingresar
- Superadministrador: https://grassgo.web.app/superadmin/ingresar

Se usa `dist/grassgo/browser`, compilado para producción con `useEmulators: false`. Las rutas Angular tienen fallback a `index.html`. Los recursos sin hash en `/assets/` se revalidan para recibir actualizaciones de temas y fotos. No se publican los snapshots locales, documentos, scripts ni credenciales de Firebase CLI.

## Pendiente para operar en internet

El intento de desplegar Cloud Functions se detuvo porque Firebase exige el plan Blaze para habilitar Cloud Build. No se activó facturación. El alojamiento está publicado, pero las reservas, el catálogo por funciones y los paneles administrativos no quedan operativos con este despliegue parcial.

El usuario debe revisar y habilitar Blaze desde https://console.firebase.google.com/project/grassgoo/usage/details si decide continuar con esa infraestructura y sus posibles costos. Después corresponde desplegar backend, reglas e índices, comprobar Firebase Authentication y Storage, asignar de forma segura el superadministrador de producción y preparar el establecimiento real. Las cuentas, reservas y publicación de El Puma del emulador NO se copiaron a producción. No usar el seed local para migrarlas; el backend de producción rechaza pagos y QR de demostración.

En esta entrega solo se publicó Hosting. No se desplegaron reglas Firestore/Storage ni índices, no se concedieron roles de producción y no se crearon usuarios remotos.

## Archivos de esta entrega

- `firebase.json`: alojamiento SPA y caché.
- `.firebaserc`: proyecto por defecto `grassgoo`; los comandos de emuladores existentes siguen usando explícitamente `demo-grassgo`.
- Este documento y `docs/screenshots/club-noviembre/deploy-firebase.png`.

## Validación

- `npm run build`: correcto, con la advertencia previa de presupuesto inicial (501,21 kB frente a 500 kB).
- `npm test -- --watch=false`: 26 pruebas correctas, 8 archivos.
- `npm run test:integration`: 81 pruebas correctas de backend y reglas en emuladores aislados de pruebas; sin cambios a datos remotos.
- Hosting confirmó liberación completada de 38 archivos.
- HTTP 200 en las tres rutas de acceso, `assets/theme.css` y `assets/club-field.svg`, con tipos de contenido correctos.
- Verificación visual del login publicado. No se afirmó funcionamiento del backend remoto ni se probaron reservas remotas.

## Comandos en Windows

Desde la raíz del proyecto, para actualizar únicamente la interfaz:

```powershell
npm run build
node scripts/firebase-local.mjs deploy --only hosting --project grassgoo --non-interactive
```

Para validar:

```powershell
npm test -- --watch=false
npm run test:integration
```

El siguiente paso es resolver la habilitación de Blaze y completar la preparación del entorno remoto antes de aceptar reservas reales.

## Actualización: inicio simplificado y tema claro

Se eliminó de `src/app/features/booking/customer-home.ts` la sección completa «Así de fácil / Del plan a la cancha» con los tres pasos. `src/app/core/services/theme.service.ts` usa claro como predeterminado cuando no hay preferencia válida; respeta la elección oscura explícita y conserva la alternancia. `src/index.html` inicia con `data-theme="light"` y barra blanca antes de cargar Angular. Se actualizaron las pruebas existentes en `theme.service.spec.ts` para comprobar la primera visita clara y la conservación del modo oscuro.

Validación: compilación correcta con la advertencia previa de 501,21 kB; 28 pruebas Angular correctas. Hosting actualizado, HTTP 200 y HTML remoto con tema claro inicial y nuevo bundle. El login público se revisó en blanco; el navegador de revisión tenía una elección oscura guardada, que se respetó hasta cambiarla mediante el botón. Captura: `docs/screenshots/club-noviembre/inicio-claro-publicado.png`. Se mantiene el bloqueo del backend remoto por Blaze descrito arriba.

Windows: `npm run build`, `npm test -- --watch=false` y `node scripts/firebase-local.mjs deploy --only hosting --project grassgoo --non-interactive`. Siguiente paso sugerido: recargar la web y revisar el inicio tras acceder.

## Corrección de datos y perfil por opciones

Diagnóstico remoto: no había Cloud Functions desplegadas y la API de Firestore estaba deshabilitada. El despliegue de funciones volvió a ser rechazado por falta de Blaze. El usuario aprobó `us-central1` para la base de datos y eligió mantener el plan gratuito.

Se habilitó Firestore y se creó `(default)` en `us-central1`, edición STANDARD compatible con el código y los emuladores existentes. La consulta remota confirma `freeTier: true`. Se desplegaron las reglas existentes y los índices, sin abrir acceso público, conceder roles ni crear registros de usuarios o negocios. Esta actualización sustituye el estado anterior de Firestore pendiente que se describe en el despliegue inicial. Se añadió `firestore.location` en `firebase.json`.

El perfil ahora muestra «Tu información» y «Acceso y seguridad» como opciones cerradas dentro del mismo recuadro del menú. Los datos de edición se consultan al abrir la opción, y cerrar/abrir no sobrescribe una edición pendiente. Se compactó la identificación de la cuenta. Se distinguen errores del servicio de datos, del servicio de acceso y de disponibilidad del backend; no se atribuye indiscriminadamente la causa a la conexión del usuario.

Archivos: `src/app/features/profile/profile.ts`, `profile.html`, `profile.spec.ts`, `src/app/core/auth/auth-errors.ts`, `src/app/core/services/booking.service.ts`, `public/assets/theme.css`, `firebase.json` y este documento. Captura de comprobación con cuenta DEMO local: `docs/screenshots/club-noviembre/perfil-opciones-cerradas.png`.

Validación: 30 pruebas Angular correctas en 9 archivos, incluidos cierre inicial, carga al seleccionar y conservación de edición; compilación correcta (misma advertencia de 501,21 kB). Verificación visual local de opciones cerradas y apertura del formulario sin error. La revisión remota redirigió al login porque no había sesión de producción en la pestaña de prueba; no se crearon cuentas para esa revisión ni se afirmó guardado remoto de un perfil. Firestore, reglas e índices fueron confirmados por Firebase CLI y Hosting actualizado con el frontend final.

Las reservas, el catálogo por funciones y las operaciones administrativas siguen pendientes en internet: el usuario mantiene Spark, que impide publicar el backend actual de Cloud Functions. No se activó facturación, no se reemplazó el backend y no se omitieron permisos para simular funcionamiento. Habrá que acordar una adaptación de arquitectura compatible con ese requisito antes de realizar cambios grandes. Los servicios locales se dejaron disponibles en `http://localhost:4201/` con el snapshot DEMO conservado.

Windows: `npm run build`, `npm test -- --watch=false`; publicar frontend con `node scripts/firebase-local.mjs deploy --only hosting --project grassgoo --non-interactive`. Siguiente paso: comprobar el perfil con la cuenta real y acordar la alternativa de backend para operar dentro del plan gratuito.

## Grass El Puma visible en el catálogo remoto

Se creó explícitamente `catalog/el-puma` en `grassgoo` como ficha publicada de prueba. Incluye Grass El Puma, Salinas/Andahuaylas, una cancha principal de fútbol, tarifas día S/ 30/noche S/ 40 desde las 18:00 y adelanto S/ 10 ya definidos por el usuario. No se inventaron horarios de apertura, contacto, fotos propias ni disponibilidad: horarios nulos y fotos referenciales existentes. La ficha indica que las reservas online están en preparación.

El catálogo en producción ahora consulta Firestore directamente, con filtro `status == published` y límite de 100 documentos. Las reglas que ya estaban desplegadas permiten esa consulta a usuarios autenticados y siguen ocultando borradores. No se publicaron en esta entrega las reglas nuevas del prototipo de reservas. El modo emuladores conserva su catálogo de backend local.

Archivos: `src/app/core/services/business-catalog.service.ts`, su prueba, `src/app/features/booking/venues.ts`, `courts.ts`, `scripts/publish-puma-catalog.mjs` y este documento. El script usa la sesión de Firebase CLI en memoria, exige un argumento explícito de publicación demo y solo crea el documento si no existe; no sustituye datos reales ni migra cuentas, roles o reservas.

Validación: 35 pruebas Angular correctas y 16 pruebas de reglas Firestore correctas en emuladores; compilación correcta con la advertencia existente de presupuesto inicial. Firebase confirmó la creación del documento y el despliegue de Hosting. No se realizó una prueba visual con cuenta de producción: no se dispone de una sesión de cliente remoto en la pestaña de verificación. El acceso debe comprobarse tras iniciar sesión en https://grassgo.web.app/sedes/el-puma/canchas.

Windows: `npm run build`; `npm test -- --watch=false`; publicar con `node scripts/firebase-local.mjs deploy --only hosting --project grassgoo --non-interactive`. El alta puntual ya se ejecutó: no repetir `node scripts/publish-puma-catalog.mjs --publish-demo-grassgoo` para evitar un conflicto de documento existente. Siguiente paso: terminar la migración de reservas a Firestore; la visibilidad del catálogo no implica que la reserva online esté habilitada.
