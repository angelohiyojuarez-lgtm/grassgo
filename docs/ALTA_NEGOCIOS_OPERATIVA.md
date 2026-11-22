# Alta y publicación de negocios deportivos

Actualización posterior: [portada y correspondencia con la interfaz del cliente](PORTADA_Y_DATOS_CLIENTE.md). El paso 1 ahora incluye galería y portada propias del establecimiento, separadas de las canchas, y el paso 5 muestra la tarjeta del catálogo antes de publicar.

Entrega local de GrassGo con Angular y Firebase. Amplía el escritorio de superadmin; no representa un despliegue en Firebase remoto ni la finalización de todos los módulos de la plataforma.

## Decisión comercial nueva

El usuario confirmó **S/ 10 de adelanto para todos los negocios**. Esta instrucción posterior sustituye, para esta versión, el criterio anterior de adelanto configurable por local. El backend rechaza agendas cuyo adelanto difiera de 1000 céntimos y la publicación fija ese importe. Las tarifas por hora son independientes por cancha. No se cambian cancelaciones ni devoluciones.

## Recorrido del superadmin

Entrar en http://localhost:4201/superadmin/negocios/nuevo. El menú y todos los enlaces propios permanecen en superadministración.

1. **Negocio:** nombre, teléfono de contacto, distrito con sugerencias Andahuaylas/San Jerónimo/Talavera y escritura de otros, dirección exacta, referencia, descripción y correo del administrador.
2. **Horarios:** días de atención y horario común. Esta versión usa bloques de una hora y apertura/cierre en horas completas dentro del mismo día; 24:00 representa medianoche. Horarios distintos por día, turnos partidos y atención después de medianoche requieren otra entrega.
3. **Canchas:** cantidad de 1 a 20 y una ficha por cancha, con nombre, fútbol/vóley/multiuso, superficie, tarifa diurna y nocturna, hora de inicio nocturno y hasta tres fotos de hasta 5 MB cada una. “Actualizar fichas” aplica la cantidad; se informa antes de quitar las últimas fichas de un borrador. La primera foto es su portada.
4. **Pagos:** adelanto fijo de S/ 10, plazo elegido por el negocio para comprobante/revisión, Yape y/o Plin, titular, número y QR. El plazo limita tanto la retención como la revisión: una solicitud vencida no se confirma. En los emuladores hay un modo de demostración que nunca debe usarse para cobros. El QR real se sube como imagen; la aplicación no verifica automáticamente su destinatario ni procesa dinero.
5. **Revisión:** muestra faltantes, permite guardar y pide revisar explícitamente los datos antes de publicar.

**Guardar borrador** acepta configuración incompleta y conserva los datos en Firestore. Después del primer guardado se abre una URL estable `/superadmin/negocios/{id}/configurar`, para retomar el trabajo desde Negocios → Ver ficha → Configurar negocio. Los archivos seleccionados solo localmente se suben durante el guardado; salir antes de guardar los pierde.

**Publicar** exige configuración completa, fotos verificadas y administrador con cuenta existente, activa y correo verificado. No se crean contraseñas ni cuentas administrativas desde el navegador. La cuenta asignada recibe únicamente la membresía de ese establecimiento; si se cambia al responsable configurado, se retira su asignación anterior al publicar. Otros miembros no se eliminan.

En la demo se puede asignar `admin@grassgo.test`. La cuenta común de pruebas continúa siendo `equipo@grassgo.test` / `GrassGoDemo2026!`. La publicación en la demo utiliza exclusivamente servicios locales.

## Conexión con cliente y administración

- El catálogo consulta establecimientos publicados y canchas activas; ya no está limitado en código a El Puma.
- Presenta ubicación, referencia, fotos, deporte y precios correspondientes. Los nuevos borradores nunca aparecen a clientes.
- Las reservas usan los identificadores reales de local/cancha y las tarifas del servidor. Un día cerrado no devuelve bloques y tampoco admite solicitudes mediante llamada directa.
- La solicitud conserva una copia de las instrucciones de pago vigentes al crearla. La UI usa esa copia para evitar cambiarle el destinatario si después se cambia la configuración.
- El administrador asignado consulta sus canchas y revisa comprobantes con aislamiento por establecimiento. Subir una imagen sigue sin verificar un pago.
- Para editar la operación de un negocio publicado se debe suspender primero desde la ficha. Se conservan sus reservas. Para volver a publicar un suspendido se debe aprobar antes. Las canchas retiradas de una nueva configuración se desactivan sin borrar el historial. No se permite retirarlas si todavía tienen reservas vigentes; los locales anteriores conservan los identificadores de sus canchas al configurarlos.

## Protección y archivos

Las nuevas operaciones son callables del servidor con comprobación del rol global activo. Hay validación de campos permitidos, tipos, cantidades, tarifas en céntimos e identificadores. El guardado usa una versión para evitar que otra pestaña sobrescriba cambios, y admite reintentos idénticos sin duplicar auditoría.

Las imágenes usan `business-media/{establishmentId}/{imageId}`. Solo un superadmin activo puede crearlas en negocios no publicados. Son inmutables desde el navegador, admiten JPG/PNG/WebP y hasta 5 MB. El servidor comprueba pertenencia del archivo, tamaño, MIME y firma binaria antes de guardar referencias o publicar. No se aceptan URLs externas como referencias de esos archivos.

Los borradores no exponen imágenes a clientes. Las imágenes de negocios publicados son legibles por clientes autenticados. Se descargan como blobs mediante el SDK y se liberan los object URLs de las vistas. Los comprobantes siguen en rutas privadas separadas. El catálogo no incluye correo administrativo ni configuración privada de pagos.

Eliminar una referencia de imagen no borra físicamente el archivo. Queda pendiente una tarea de limpieza de archivos huérfanos con retención definida. La cuenta de superadmin es de confianza: límites de frecuencia/cuotas y monitoreo deben endurecerse antes de abrir producción.

## Ejecución y pruebas en Windows

Con los servicios locales ya en marcha, abrir la URL de arriba. Para iniciar desde cero:

```powershell
# Terminal 1
npm run emulators
```

```powershell
# Terminal 2, una vez listos los emuladores
npm run seed:emulators
npm run start:emulators -- --port 4201
```

El seed es para una demo nueva: no debe usarse como migración de negocios reales. Los emuladores tienen datos temporales; conservar un export antes de reiniciarlos. Esta entrega no cambia usuarios ni datos del Firebase remoto.

```powershell
npm run build
npm test -- --watch=false
# Detener primero los emuladores interactivos tras exportar sus datos.
# Suite de backend y reglas en puertos de prueba (8085/9195):
npm run test:integration
# Con los cuatro emuladores habituales y cuentas demo preparadas:
npm run smoke:business
```

No ejecutar dos emuladores de Storage simultáneamente: en esta máquina interfieren sus servicios y la resolución de proyecto de las reglas cruzadas. La suite usa `demo-grassgo`, igual que su bucket de pruebas, en una ejecución separada. Para respaldar la demo mientras está en marcha y recuperarla después:

```powershell
node scripts/firebase-local.mjs emulators:export .firebase/demo-safe --project demo-grassgo --force
# Tras detenerla / terminar las pruebas:
npm run emulators -- --import .firebase/demo-safe --export-on-exit .firebase/demo-safe
```

Validación de esta entrega: 12 pruebas Angular y 58 escenarios de backend/reglas aprobados. La prueba SDK completa validó subida de fotos y QR, borrador reabrible, publicación, catálogo, vóley con su tarifa, adelanto de S/ 10, comprobante privado, asignación de administrador y confirmación. Retira únicamente sus fixtures temporales. También se revisó la creación de fichas e imágenes desde el formulario de escritorio.

## Pendientes para uso real

Revisar la configuración/edición de Firebase remoto, autenticar el despliegue y publicar reglas/funciones; cargar fotos, horarios, responsable y QR auténticos de cada local; validar las políticas comerciales y probar con dispositivos reales. No hay verificación automática de Yape/Plin. Quiosco, empleados, cancelaciones, reembolsos, notificaciones y suscripciones continúan con su propio roadmap.

Archivos principales: `functions/business-api.js`, `functions/index.js`, motor de reservas, reglas de Storage; `features/platform/business-editor.*`; servicios de catálogo/medios, pantallas de locales/canchas/reservas, pruebas y configuración de emuladores de prueba.
