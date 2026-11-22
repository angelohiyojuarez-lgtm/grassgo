# Datos del negocio y QR del dueño

Entrega del 19 de noviembre de 2026. Disponible en **Administración → Mi local →
Datos y QR de pago**, conservando Angular 22 y Firestore Standard del proyecto
`grassgoo`. No requiere nuevos servicios, Storage ni Cloud Functions.

## Uso sencillo

Hay dos tarjetas con controles grandes y guardados independientes:

1. **Datos del negocio:** celular de contacto, referencia para llegar y descripción.
   Pulsar **Guardar datos del negocio**. Estos campos se muestran a los clientes
   en la ficha del establecimiento; no modifican la cuenta personal del dueño.
2. **Cómo recibir el adelanto:** pulsar **Subir foto de mi QR** o **Cambiar foto
   de mi QR**, elegir JPG/PNG/WebP de hasta 5 MB y revisar la vista previa.
   Seleccionar Yape/Plin, completar titular y celular de pago. Marcar la revisión
   del QR y titular y pulsar **Guardar QR y datos de pago**.

El celular de contacto y el número para recibir el adelanto pueden ser distintos.
Cambiar foto, titular, número o método obliga a revisar nuevamente la casilla.
La aplicación prepara la imagen, pero no certifica que contenga un QR de pago
auténtico ni consulta el saldo de Yape/Plin. El dueño comprueba los datos y sigue
verificando manualmente el dinero recibido antes de confirmar cada reserva.

Guardar no habilita automáticamente reservas. El local necesita además canchas,
horarios y habilitación operativa completos. No se inventaron datos para El Puma.
Las solicitudes existentes conservan su QR, titular y número originales; el cambio
se aplica a solicitudes nuevas. Se mantienen precios, adelanto y permisos.

**Horarios y cierres** continúa como segundo acceso dentro de Mi local. Antes de
cambiar de apartado, local o página se avisa si hay cambios sin guardar. Durante
la preparación de foto o el guardado se bloquean los cambios de apartado. Consultar
los datos guardados de una tarjeta conserva el borrador de la otra.

## Persistencia y autorización

- Contacto canónico: `establishments/{id}/settings/contact`. Espejo en el documento
  `catalog/{id}` únicamente en celular, descripción, referencia y metadatos de revisión.
- Pago canónico: `establishments/{id}/settings/payment`. Espejo exacto de las cinco
  propiedades de `catalog/{id}.booking.payment`; no puede modificar `enabled`,
  `engine`, `holdMinutes`, estado de publicación, precios ni roles.
- Cada guardado exige canónico, proyección e historial privado inmutable en una
  transacción. Revisiones consecutivas evitan sobrescribir cambios de otra pantalla.
- Fotos en `catalog/{id}/paymentQrs/{uuid}`, inmutables, sin listado de versiones.
  El puntero `payment-qrs/{id}/{uuid}` se resuelve al mostrar la foto. No se incluye
  el JPEG en los listados de establecimientos ni en los snapshots de solicitudes.
- Una foto nueva se guarda atómicamente con su configuración. Versiones anteriores
  se conservan para solicitudes existentes. Se prohíben reemplazo, borrado y uso de
  referencias a otro establecimiento.
- La imagen se decodifica y dibuja nuevamente como JPEG, sin recorte, hasta 1600 px
  por lado y 420000 caracteres de dataURL. SVG/HTML, archivos vacíos, tipos no
  admitidos e imágenes que no se pueden decodificar se rechazan. Las reglas validan
  esquema, prefijo/base64, límites y metadatos; no decodifican el binario del QR.
- Autorización mediante membresía canónica activa del local y motor directo;
  clientes, miembros suspendidos y administradores ajenos no pueden escribir.
  El dueño puede consultar su ficha en borrador. Consultas generales del catálogo
  continúan limitadas a publicaciones; QR público permite lectura exacta autenticada
  de un local publicado, sin listado masivo.
- La creación de una solicitud consulta el catálogo posterior de la operación
  atómica: combinar cambio de pago y reserva no permite usar un snapshot anterior.
- Primer guardado crea la configuración; no se requiere migración ni índice nuevo.

## Verificación y publicación

- **177/177 pruebas Angular**, incluidas preparación de fotos, lectura de QR,
  revisiones, borradores, errores, aislamiento de formularios y navegación.
- **149/149 pruebas de integración**. La suite de contacto/pago/QR aporta 16
  pruebas y las regresiones de horarios/reservas directas pasan 58/58 en conjunto.
- Probados: escalamiento de permisos, otro tenant, suspensión, esquema/tipos/tamaño,
  QR ajeno, campos protegidos, escrituras sin espejo/historia, revisión obsoleta,
  QR inmutable y operaciones concurrentes. Auditoría independiente sin bypass confirmado.
- Navegador con fixture DEMO: contacto y descripción publicados, foto PNG preparada
  y guardada, QR visible en nueva solicitud, reemplazo por segunda foto y conservación
  del QR anterior en la solicitud. El estado siguió pendiente/sin verificar.
- Escritorio y móvil a 320 px, temas claro/oscuro: sin desbordamiento horizontal;
  controles del formulario medidos desde 58 px, etiquetas legibles y QR cargado.
- Capturas reales del fixture: `screenshots/datos-qr-local-escritorio.jpg` y
  `screenshots/datos-qr-local-movil.jpg`. Son códigos de prueba **NO PAGAR**.
- Compilación de producción correcta. Continúan advertencias de objetivo: inicial
  501,56 kB frente a 500 kB; panel 7,72 kB, horarios 4,20 kB, datos 4,00 kB frente
  a 4 kB por estilo. Todos quedan bajo el máximo 8 kB; no se ampliaron presupuestos.
- Reglas compiladas y publicadas junto con Hosting en `https://grassgo.web.app`.
  El compilador conserva advertencias de inferencia `null/map` en ramas opcionales;
  se probaron configuración ausente, primera creación y actualizaciones.

Nota exigida por la skill de creación de reglas:

> I've set up prototype Security Rules to keep the data in Firestore safe. They
> are designed to be secure for canonical tenant membership, strict schemas,
> immutable QR versions, and atomic configuration, projection and history writes.
> However, you should review and verify them before broadly sharing your app.
> If you'd like, I can help you harden these rules.

## Archivos modificados

- Nueva pantalla `src/app/features/staff/admin-local-business.{ts,html,css,spec.ts}`.
- Navegación y protección de edición en `staff-dashboard.{ts,html,css,spec.ts}`.
- Modelo `src/app/core/models/establishment-business.ts`.
- Servicios y pruebas: `establishment-business.service`, `payment-qr-image` y
  `business-media.service`, dentro de `src/app/core/services/`.
- `firestore.rules`, `tests/direct-business-settings.rules.test.mjs`, `package.json`.
- `scripts/qa-business-settings.mjs`, capturas, README y documentación de horarios.

## Windows

```powershell
npm start
npm test -- --watch=false
npm run test:business-settings
npm run test:integration
npm run build
```

Prueba manual exclusivamente local, con los emuladores de Auth/Firestore en
9099/8080 y `seed:direct-emulators` preparados:

```powershell
node scripts/qa-business-settings.mjs setup
npm run start:direct-emulators -- --port 4201
node scripts/qa-business-settings.mjs verify
node scripts/qa-business-settings.mjs cleanup
```

El fixture utiliza `qa-business-settings`, una cuenta cliente ficticia y dos PNG
de prueba en `.firebase/`. Rechaza servicios externos y datos sin su marca;
la limpieza retira solo este negocio, sus versiones e historial y su cliente.
El Puma y los demás establecimientos se conservan.

Siguiente paso: el dueño ingresa su contacto y QR reales; después completar la
configuración de canchas necesaria para habilitar reservas operativas.
