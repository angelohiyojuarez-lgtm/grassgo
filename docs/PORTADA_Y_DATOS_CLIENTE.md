# Portada del establecimiento y correspondencia con el cliente

Se separan las fotos generales del negocio de las fotos de cada cancha. La tarjeta de establecimientos usaba la primera foto de la primera cancha; ahora utiliza exclusivamente la portada del negocio. El Puma conserva su imagen histórica marcada como referencial cuando todavía no tiene portada propia. Otros registros antiguos sin portada muestran que la foto está pendiente; no se sustituye por una cancha.

## Qué se configura y dónde aparece

| Lo que ve el cliente | Configuración del superadmin |
| --- | --- |
| Foto del establecimiento en el listado | Paso 1: Fotos del establecimiento; la primera es la portada y se puede cambiar con “Usar como portada” |
| Galería general al entrar al local | Paso 1: hasta 5 fotos del establecimiento, incluida la portada |
| Nombre, distrito y dirección | Paso 1: datos del negocio |
| Descripción y referencia para llegar | Paso 1: descripción y referencia |
| Número de contacto | Paso 1: teléfono del negocio; se muestra al cliente como enlace para llamar |
| Días y horas de atención | Paso 2: días, apertura y cierre; también se muestran en la información del local |
| Cantidad de canchas y deportes | Paso 3: se calculan desde las fichas de canchas |
| Foto de cada cancha y sus vistas adicionales | Paso 3: galería independiente por cancha |
| Tipo, superficie, tarifa de día/noche e inicio nocturno | Paso 3: datos de cada cancha |
| Adelanto, métodos, titular, número y QR | Paso 4: pagos; adelanto fijo S/ 10 confirmado por el propietario |
| Bloques disponibles de una hora y estado de reserva | Calculados por el servidor desde la configuración y ocupación; no son campos inventados del formulario |

El paso 5 incluye una **vista previa de la tarjeta de cliente**, con portada, nombre, ubicación, cantidad de canchas, deportes y adelanto. También resume contacto, descripción, referencia y días de atención. La publicación comprueba que exista una portada propia además de las imágenes requeridas de las canchas.

## Datos y permisos

- `configuration.images`: galería del establecimiento, máximo 5; índice 0 es la portada.
- `configuration.courts[].images`: fotos de esa cancha, máximo 3 por cancha.
- Se mantiene `business-media/{establishmentId}/{imageId}` con las mismas reglas de acceso. No se cambiaron las reglas de Storage ni las de comprobantes.
- El servidor valida pertenencia, cantidad, tamaño, MIME y firma binaria de las nuevas fotos, tanto al guardar como al publicar.
- Los borradores anteriores se abren con la galería general vacía, conservando sus demás campos y su versión. No se asignan fotos de canchas automáticamente ni se modifican registros del usuario como migración.
- Elegir/quitar/reordenar una foto marca cambios pendientes; solo se persisten al guardar.

## Validación y ejecución en Windows

```powershell
npm run build
npm test -- --watch=false
# Con Firestore Emulator local ya en marcha; esta suite usa su propio proyecto de pruebas:
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
node --test functions/tests/business-api.test.mjs
# Con los cuatro emuladores y las cuentas demo preparadas:
npm run smoke:business
```

El smoke comprueba que la portada del catálogo sea distinta de la foto de la cancha y que el cliente autenticado pueda descargarla. Se mantiene el recorrido completo de reserva y comprobante. Sus registros temporales se retiran al terminar. No ejecutar otro emulador Storage a la vez que la demo.

Validación ejecutada para este ajuste: compilación de producción sin advertencias, 16 pruebas Angular y 15 pruebas del API de negocios aprobadas, más el smoke completo con los cuatro servicios locales. Las reglas de permisos existentes no se modificaron.

Para abrir una configuración guardada: **Negocios → Ver ficha → Configurar negocio → Negocio**. Los servicios locales siguen en http://localhost:4201/. El despliegue remoto no forma parte de este ajuste.

Archivos modificados: modelo de configuración, editor y vista previa, API de negocios y validación de publicación, servicio del catálogo, listado de locales y detalle con galería/contacto/horarios, estilos y pruebas.
