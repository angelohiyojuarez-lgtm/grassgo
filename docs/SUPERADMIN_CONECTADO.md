# Superadmin conectado — 20 de noviembre de 2026

La entrega posterior [Flujo unido y avisos](FLUJO_UNIDO_Y_AVISOS.md) incorpora el
alta, las invitaciones al dueño, publicación guiada, indicadores operativos e
historial común con campana y sonido para los tres roles. Los pendientes de
incorporación mencionados en esta entrega inicial quedan sustituidos por ese
documento actualizado.

## Problema corregido

El acceso comprobaba correctamente el rol, pero el panel intentaba consultar
Cloud Functions sin un despliegue activo. Cliente y administrador del local ya
utilizaban Firestore directamente. Por eso el superadmin no podía mostrar El
Puma ni sus indicadores aunque el negocio existiera.

Con Angular y el Firebase existente se conectaron `platformOverview`,
`platformActivity` y `setEstablishmentStatus` al transporte directo. El backend
HTTP y el modo de emuladores anterior conservan su selección explícita.

## Qué muestra ahora

- **Negocios:** contador global obtenido del servidor, incluso cuando el
  directorio carga solo sus primeros 100 registros.
- **Canchas:** todas las canchas registradas en los negocios cargados. La ficha
  muestra hasta 20 canchas activas y sus tarifas existentes.
- **Publicados:** contrasta estado privado y catálogo público. Un local aprobado
  con su ficha publicada sí cuenta como visible; un suspendido no.
- **Reciben reservas:** requiere ambos permisos de agenda habilitados y una
  configuración válida y sincronizada. Subir un QR no verifica ningún pago.
- **Necesitan atención:** muestra los requisitos pendientes reales, como dueño,
  cancha con precios, días abiertos, horarios sincronizados o QR de pago.
- **Ficha del negocio:** ofrece la vista del cliente si está publicado, y el
  acceso al panel del local solo si la cuenta tiene su propia membresía activa.
- **Actividad:** consulta las últimas 30 entradas de auditoría global. Todavía
  no integra todos los historiales de horarios, precios, comprobantes y partidos
  del motor directo.

Las fichas se actualizan cuando cambian los establecimientos o sus proyecciones
del catálogo. El botón **Actualizar datos** consulta nuevamente el servidor.
Un fallo de actividad no borra los contadores válidos del resumen. Un fallo de
permisos o lectura de negocios retira los indicadores para evitar mostrar datos
anteriores como actuales.

## Cambios de estado con efectos entre los tres roles

Solo un superadmin activo puede confirmar un cambio. Las reglas del servidor
validan la transición y las copias, además del control de la interfaz.

- **Suspender:** cambia el estado privado y público, deshabilita nuevas reservas
  y bloquea el acceso administrativo del dueño. Conserva documentos y reservas.
- **Aprobar:** devuelve el acceso al local si mantiene una membresía activa. La
  ficha pública queda como borrador y las reservas siguen deshabilitadas. La
  aprobación no publica ni inventa horarios, tarifas o información de pago.

Cada cambio escribe atómicamente la ficha privada, la pública cuando existe y
una auditoría inmutable con autor, hora del servidor y un UUID nuevo. No crea
fichas ausentes. Aprobar un local ya aprobado no cambia su publicación.

No se ampliaron permisos para que el superadmin leyera comprobantes, reservas
privadas o perfiles de clientes. Las membresías y los roles siguen sin poder
modificarse desde el navegador.

## Funciones que siguen pendientes

El alta de nuevos negocios, asignación de dueños y publicación operativa todavía
requieren conectar sus flujos al backend directo. En este modo se evita abrir
el editor anterior, que dependía de servicios no desplegados, también cuando
alguien accede mediante su URL. Los negocios existentes se configuran desde el
panel de su dueño.

Siguiente incremento recomendado: registro del negocio, asignación segura de su
dueño y lista de requisitos antes de publicar y habilitar reservas. Después,
resumen por negocio de reservas de hoy y comprobantes pendientes, avisos internos
e historial común. Los planes comerciales requieren definir sus condiciones.

## Verificación y ejecución en Windows

```powershell
npm test -- --watch=false
npm run test:direct-platform
npm run test:integration
npm run build
Start-Process 'https://grassgo.web.app/superadmin/inicio'
```

Las pruebas usan proyectos `demo-*` y emuladores; no alteran datos de producción.
Cubren aislamiento, rol suspendido, coherencia de indicadores, cambios atómicos,
auditoría falsificada, reintentos, restricciones de lectura y una cuenta con
ambos roles que continúa guardando horarios, precios y QR de su local.

Resultado: **255 pruebas de Angular y 197 de integración aprobadas**, con
compilación de producción correcta. Persisten las advertencias previas de tamaño
del bundle inicial y tres estilos del panel del local; no se aumentaron sus
límites.

Se publicaron las reglas y Hosting en `grassgo.web.app`. La comprobación con la
sesión real del superadmin mostró **1 negocio, 1 cancha, 1 publicado y 0 agendas
habilitadas**. El Puma aparece con dueño asignado y horarios configurados; falta
el QR y la información real de pago. Se verificaron el directorio, su ficha y la
actividad. [Captura del resultado](screenshots/superadmin-conectado.jpg).

Archivos principales: `core/models/platform.ts`,
`core/services/direct-platform.service.ts`, `core/services/booking.service.ts`,
`features/platform/platform-dashboard.ts`, su HTML y CSS, `firestore.rules` y sus
pruebas. `package.json` incorpora la comprobación focal al conjunto de integración.
