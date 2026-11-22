# Panel del local fácil de usar — 19 de noviembre de 2026

Actualización posterior: **Mi local** ya permite editar horarios y cierres en el
motor directo. Ver [Horarios y fechas cerradas](HORARIOS_Y_CIERRES.md).

Se conserva Angular, Firebase y el diseño deportivo existente. Este incremento
mejora la navegación y revisión de comprobantes ya conectadas. La configuración
operativa de Mi local, las reservas presenciales y el control de partidos del
motor directo continúan en sus siguientes incrementos; no se muestran botones
de esas funciones como si ya estuvieran disponibles.

## Cambios visibles

- Dos accesos grandes: **Ver mi agenda** y **Revisar comprobantes**.
- Botones de 56 px de alto como mínimo y acciones principales de 62 px; las
  tarjetas de navegación miden 132 px en escritorio. Texto de controles de 17 px
  y títulos de tareas de 20–22 px.
- En celular se compacta la cabecera para mantener visibles las tareas principales,
  conservando sus tamaños y evitando superposición de nombre y botón Actualizar.
- Un solo establecimiento muestra su nombre; el selector aparece si hay varios.
- Atajos **Hoy**, **Mañana** y **Otra fecha**; filtros secundarios desplegables.
- El modo directo muestra indicadores que realmente registra: reservas confirmadas
  y comprobantes. Los indicadores de partidos se conservan para el modo anterior.
- La revisión de fotos guía tres pasos: mirar foto, comprobar ingreso real y
  confirmar. La foto puede ampliarse. Los errores se muestran dentro del diálogo.
- Rechazar requiere una segunda confirmación. La revisión mantiene el foco del
  teclado dentro del cuadro, Escape permite cerrarlo y se bloquea el desplazamiento
  del fondo. Durante una escritura no se cierra con Escape.

## Bandeja de comprobantes

En el motor directo muestra solicitudes vigentes de todas las fechas, ordenadas
por vencimiento, en lugar de depender del día seleccionado en la agenda. Consulta
solamente pendientes creados dentro de los últimos 15 minutos (plazo ya existente)
y descarta solicitudes cuyo inicio ya pasó. Así las solicitudes antiguas vencidas
no llenan la bandeja. Se informa cuando se alcanza el límite de 100 resultados.

No descarga imágenes al cargar el listado. Antes de consultar, lee el local
privado para exigir su membresía canónica. Las reglas de autorización existentes
siguen siendo la protección efectiva. El modo anterior conserva la consulta por
fecha porque no dispone de la nueva operación de lectura.

Se añadió el índice de `direct_requests` con `establishmentId`, `status` y
`createdAt` ascendentes. Fue desplegado y comprobado en estado `READY`.

## Validación

- Compilación de producción correcta. Se conserva la advertencia inicial de
  501,27 kB frente a 500 kB; el estilo del panel queda por debajo del máximo de
  8 kB, con advertencia sobre el objetivo de 4 kB. No se aumentaron los presupuestos.
- **85 pruebas Angular aprobadas**, incluidas consultas privadas, rechazo en dos
  pasos, validación manual, foco/escape, errores y descarte de respuestas antiguas.
- Navegador con administrador ficticio: dos comprobantes de fechas futuras,
  exclusión de uno vencido, rechazo y confirmación. No se hicieron pagos reales.
- Revisión en escritorio y a 320 px, temas claro/oscuro; sin desbordamiento
  horizontal. Los fixtures se retiraron después de verificar sus estados.
- Capturas: `screenshots/admin-facil-escritorio.jpg` y
  `screenshots/admin-facil-movil.jpg`, ambas del negocio DEMO local.

## Archivos

- `src/app/features/staff/staff-dashboard.{ts,html,css,spec.ts}`.
- `src/app/core/services/{direct-booking,booking}.service.ts` y prueba del primero.
- `firestore.indexes.json`, `scripts/qa-admin-simple.mjs`, `README.md` y este documento.

## Windows

```powershell
npm run build
npm test -- --watch=false
# Con los emuladores de Auth/Firestore locales preparados:
npm run start:direct-emulators -- --port 4201
```

El fixture de revisión solo funciona en `demo-grassgo` y Firestore loopback:

```powershell
node scripts/qa-admin-simple.mjs setup
node scripts/qa-admin-simple.mjs verify
node scripts/qa-admin-simple.mjs cleanup
```

Publicar solamente la interfaz compilada:

```powershell
node scripts/firebase-local.mjs deploy --only hosting --project grassgoo --non-interactive
```

La publicación de esta entrega se completó en `https://grassgo.web.app`.
Se verificaron HTTP 200 en el acceso administrativo, la ruta del panel y su módulo
JavaScript, con el mismo bundle final que la compilación local. No se modificaron
cuentas, roles, datos de pago ni reservas de producción en este incremento.

Siguiente paso sugerido: conectar Mi local con configuración guiada y autorización
por establecimiento para completar horarios y datos reales de atención/pago.
