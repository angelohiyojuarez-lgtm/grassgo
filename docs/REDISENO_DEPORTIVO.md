# GrassGo · Identidad deportiva

Actualización visual del 23 de octubre de 2026. Paleta: verde profundo #103E2D, lima #C6F36A, fondo #F7F8F5 y blanco. El lima destaca acciones y titulares sobre verde; los textos sobre lima son oscuros.

## Cambios
- Acceso: composición dividida, fotografía deportiva referencial y formulario blanco. En celular se apilan las secciones.
- Inicio: fotografía a todo el ancho del bloque principal, llamada «Ver canchas», pasos del recorrido y accesos a reservas/perfil.
- Administrador y superadmin: navegación verde profunda, selección lima, tarjetas más discretas y colores coordinados.
- Catálogo, calendario, horarios, comprobantes y perfil reciben la paleta compartida. Se mantienen mensajes de error y estados con texto.
- Se reutiliza la imagen referencial existente: no representa una foto real de un establecimiento.
- Se respetan las preferencias de movimiento reducido y el foco visible del teclado.

## Archivos
- `src/sport.css`: identidad, composición, controles y adaptación móvil.
- `src/cyan.css` y `src/platform.css`: colores base coordinados para evitar restos azules en componentes existentes.
- `angular.json`: carga del tema deportivo después de los estilos base.
- `src/app/features/auth/auth-page.html`: nueva presentación del acceso.
- `src/app/features/booking/customer-home.ts`: presentación del inicio y pasos informativos; lógica de reservas conservada.

No se modificaron servicios Firebase, permisos, base de datos, tarifas ni cálculo de horarios.

## Verificación
- Compilación de producción correcta.
- 19 pruebas Angular aprobadas.
- Revisión visual del acceso, inicio, administrador y formulario de superadmin en navegador.
- Vista responsive del acceso y del inicio a 390 píxeles de ancho, comprobada en marcos de navegador.

## Windows
```powershell
npm run start:emulators -- --port 4201
npm run build
npm test -- --watch=false
```
El servidor local está en http://localhost:4201. Para revisar el diseño del cliente: `/inicio` y `/ingresar`. El backend local debe estar activo para consultar reservas. No se realizó despliegue remoto.

Siguiente paso: revisar las pantallas con fotografías reales del local y ajustar detalles visuales según las preferencias del usuario.

## Ajuste de tipografía y fondo · 23 de octubre

Se incorporó Manrope variable autoalojada (licencia OFL en src/assets/fonts), con títulos de peso 600 y espaciado menos cerrado. Fondo blanco con difuminados lima y verde, fotografía principal más luminosa, pasos destacados y tarjetas blancas. El color de navegador coincide ahora con el verde de marca. Los estilos se comparten con los tres roles; no se modificó lógica de reservas ni permisos.

Validación: `npm run build` correcto. Revisión visual del inicio en http://localhost:4201/inicio. Captura: screenshots/grassgo-manrope-lima.jpg. La fuente queda incluida por el empaquetador, sin depender de Google Fonts al visitar la aplicación.

En PowerShell: `npm run build`. Para iniciar el frontend con emuladores ya encendidos: `npm run start:emulators -- --port 4201`.

Siguiente paso: revisar esta dirección visual con el usuario antes de otra remodelación estructural.

## Login móvil con fotografía de fondo

En pantallas de hasta 700 px se muestra la fotografía a pantalla completa mediante una capa fija con `background-size: cover`, preservando proporciones. La capa oscura atenúa la imagen y el formulario usa tarjeta blanca semitransparente. Se compactó el encabezado, se ajustó el contraste del logo y se permitió el desplazamiento vertical para pantallas pequeñas, registro y teclado. El diseño de escritorio conserva su composición anterior.

Archivo: src/sport.css. Validación: `npm run build` correcto y revisión visual de login con campos de correo y contraseña en marcos de 390 × 844 y 320 × 740. Captura: screenshots/grassgo-login-fondo-movil.jpg. Se usó un servidor temporal del build para revisar el formulario sin cerrar la sesión del usuario; servidores temporales detenidos al finalizar.

Windows: `npm run start:emulators -- --port 4201` con emuladores iniciados; abrir /ingresar en un celular o vista adaptable. Siguiente paso: revisar el acabado en el teléfono del usuario.

## Resumen y adelanto separados

Se simplificó booking-flow.html: Fecha → Hora → Resumen → Adelanto. El resumen presenta el botón Pagar adelanto de S/ 10 y no muestra QR ni carga de archivos. Al pulsarlo, la función existente create() revalida y retiene el horario en backend antes de abrir el paso de QR y comprobante. Se eliminó el selector de comprobante de ejemplo duplicado; la carga efectiva permanece en el paso final. Los avisos de demostración y la revisión manual siguen presentes. sport.css centra el resumen y adapta los cuatro pasos a móvil.

Validación visual del resumen en /reservar/el-puma/principal; captura screenshots/reserva-resumen-separado.jpg. Windows: npm run build; npm test -- --watch=false. Siguiente paso: recorrer el pago simulado desde el teléfono.

## Compartir reservas

Componente compartido reservation-share.ts en Mis reservas y después de enviar el comprobante. Permite revisar el texto, abrir las aplicaciones del dispositivo si Web Share está disponible, preparar WhatsApp o correo, y copiar datos con alternativa manual. El usuario selecciona destinatario y confirma el envío en su aplicación. No se envían mensajes automáticamente. No se comparte enlace privado, ID del cliente, QR ni comprobante. Se incluye el estado actual, aviso si falta confirmar, horario estimado en Perú cuando existe y marca de demostración. El mensaje es una instantánea y no se actualiza después de enviarse.

Archivos: shared/reservation-share.ts, reservation-share-text.ts y sus pruebas; booking/my-reservations.ts; booking-flow.ts/html; sport.css. Validación: build y 21 pruebas aprobadas; vista previa y copia verificadas en /reservas. Windows: npm run build; npm test -- --watch=false. Siguiente paso: probar Más aplicaciones desde un teléfono; disponibilidad depende del navegador y las aplicaciones instaladas.

## Logo aportado por el usuario

Se incorporó la imagen original en public/assets/brand/grassgo-logo.png, conservando exactamente su contenido (hash SHA256 comprobado contra el archivo adjunto). Se muestra completa, sin estirar ni recortar, junto al nombre de GrassGo en el encabezado de clientes y administradores, los accesos, la barra del superadministrador y el pie de página. El texto contiguo proporciona el nombre accesible y la imagen decorativa usa alt vacío para no duplicar la lectura. src/index.html utiliza la misma imagen como favicon PNG y apple-touch-icon.

Archivos: app.html, auth-page.html, platform-dashboard.html, sport.css, index.html y el nuevo recurso. Verificación visual en el inicio y login de 390 px; build correcto. Se reinició únicamente el servidor Angular para que sirva el nuevo recurso; los emuladores siguen activos. Capturas: screenshots/grassgo-logo-integrado.jpg y screenshots/logo-movil.jpg.

Windows: npm run build; npm run start:emulators -- --port 4201 con emuladores iniciados. Siguiente paso: revisar el logo desde el teléfono y recargar la pestaña si el navegador conserva el favicon anterior.
