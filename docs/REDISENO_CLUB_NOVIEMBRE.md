# GrassGo Club · rediseño integral

Fecha: 2 de noviembre de 2026 (America/Lima).

## Resultado

Se sustituyó la dirección visual anterior por una interfaz de club deportivo: fondo marfil, verde profundo, lima, detalles terracota, títulos Barlow Condensed y texto Manrope. Ambas fuentes están autoalojadas; se incluye la licencia OFL de Barlow. Se conserva el logo aportado por el usuario.

- Cliente: nuevo inicio editorial de dos columnas en escritorio, composición vertical en celular, cartel fotográfico, banda deportiva y accesos directos. Catálogo con tarjetas divididas, perfil como ficha de miembro, reservas como tarjetas, calendario y franjas horarias con nueva jerarquía.
- Accesos: cartel deportivo con fotografía y sello gráfico; formulario separado en escritorio y tarjeta sobre fotografía atenuada en móvil. Aplica también a registro y recuperación y a los accesos administrativos.
- Administrador: cabecera de operación, selector de establecimiento, navegación horizontal, indicadores, filtros, agenda, mantenimiento y configuración con las nuevas superficies.
- Superadministrador: barra lateral clara, resumen editorial, métricas reales, directorio, formularios de alta, actividad, configuración y editor de negocios con nuevos pasos y campos.
- Pago: se mantiene el recorrido Fecha → Hora → Resumen → Adelanto, con QR y comprobante en su paso. Compartir y calificar conservan sus controles y estados.

## Archivos

- `src/club.css`: nuevo sistema visual, componentes y adaptaciones de 320/390 px, escritorio y movimiento reducido.
- `angular.json`: activa club.css en lugar de sport.css, conservando cyan.css y platform.css como base de componentes. sport.css se conserva como referencia y ya no se carga.
- `src/assets/fonts/barlow-condensed-semibold.ttf`, `OFL-BarlowCondensed.txt`: tipografía de títulos y licencia.
- `src/app/features/booking/customer-home.ts`: nueva composición del inicio.
- `src/app/features/booking/venues.ts`, `my-reservations.ts`: textos de presentación.
- `src/app/features/auth/auth-page.html`, `staff/staff-dashboard.html`, `platform/platform-dashboard.html`, `profile/profile.html`: nueva presentación de cada portal.
- `src/index.html`: color de navegador consistente con el nuevo verde.
- `docs/design-history/sport-before-november.css`: copia del diseño previo.

No hubo cambios en servicios de autenticación, roles, reglas, reservas o verificación de pagos. No se crearon reservas durante esta revisión. Se inició el entorno local desde `.firebase/demo-safe`, sin ejecutar el seed general, y se volvió a habilitar únicamente la publicación del piloto demo con el script existente para revisar el catálogo y sus horarios.

## Verificación

- `npm run build`: correcto, sin advertencias de presupuesto. Carga inicial 493,25 kB / transferencia estimada 122,76 kB.
- `npm test -- --watch=false`: 23 pruebas aprobadas en 7 archivos.
- Prettier: archivos cambiados verificados.
- Revisión visual: acceso, inicio, catálogo, ficha de cancha, fecha, horas, resumen, perfil, administrador, superadministrador y editor de un borrador existente.
- Se recorrió catálogo → cancha → calendario → horario → resumen en móvil, sin crear una solicitud.
- Ancho comprobado sin desbordamiento horizontal a 320 px: resumen, perfil, reservas y administrador; a 390 px: inicio, catálogo y calendario.
- Se corrigió el contraste del elemento activo en navegación móvil y del usuario en la barra de superadministración.
- El ajuste temporal de viewport del navegador se restableció al terminar las pruebas de tamaño.

Capturas en `docs/screenshots/club-noviembre/`: inicio-escritorio.jpg, inicio-movil.jpg, administrador.jpg, superadministrador.jpg, editor.jpg.

## Ejecutar desde PowerShell

Con los emuladores ya iniciados:

```powershell
npm run start:emulators -- --port 4201
```

Si necesitas iniciarlos preservando el snapshot local:

```powershell
node scripts/firebase-local.mjs emulators:start --project demo-grassgo --only auth,firestore,functions,storage --import .firebase/demo-safe --export-on-exit .firebase/demo-safe
```

Validar:

```powershell
npm run build
npm test -- --watch=false
```

Vistas:

- Cliente: http://localhost:4201/inicio
- Administrador: http://localhost:4201/admin/inicio
- Superadministrador: http://localhost:4201/superadmin/inicio
- Revisión adaptable local: http://127.0.0.1:4300/?width=390

El visor adaptable usa un iframe del proyecto real y controles para cambiar de pantalla y ancho; está en `.firebase/qa-club`, fuera del sitio publicado. Puede reiniciarse con `python -m http.server 4300 --bind 127.0.0.1 --directory .firebase/qa-club`.

Siguiente paso sugerido: revisar el recorrido en el teléfono del usuario y decidir ajustes de acabado sobre esta nueva dirección visual.

## Fondo deportivo con más identidad

Se reemplazó el marfil plano por un fondo de luz verde y lima con franjas diagonales y líneas vectoriales inspiradas en canchas. `src/assets/club-field.svg` aporta círculos, trazos y marcas discretas sin recursos externos. `src/club.css` comparte este fondo entre cliente, acceso de escritorio y plataforma, adapta la posición del patrón en móvil y armoniza el encabezado. En el acceso móvil se conserva la fotografía de fondo solicitada por el usuario.

Validación: revisión visual en inicio de escritorio y visor de 390 px; compilación correcta con `npm run build`. No se añadieron pruebas de lógica para este cambio decorativo. Captura: `screenshots/club-noviembre/fondo-deportivo.jpg`.

Windows: `npm run build`; para verlo, `npm run start:emulators -- --port 4201` con los emuladores encendidos. Siguiente paso: revisar la intensidad del fondo en el teléfono.

## Fondo geométrico de líneas rectas

Se sustituyeron curvas y difuminados del fondo por retícula de 80 px (64 px en móvil), franjas diagonales de bordes definidos, planos lima y marcas rectas. Se actualizó `src/assets/club-field.svg` y la variable compartida de `src/club.css`; el ajuste mantiene la composición de las pantallas aprobada por el usuario. Comprobación visual en inicio y visor móvil de 390 px. `npm run build` correcto. Captura: `screenshots/club-noviembre/fondo-lineas-rectas.jpg`.

Windows: `npm run build`. Siguiente paso: revisar el nuevo acabado en /inicio desde el teléfono.

## Neon Club

El usuario pidió sustituir la paleta pastel por colores neón. Se aplicó fondo grafito #080f0d, verde eléctrico #00ff94 y lima #bdff00, conservando las líneas rectas. Se ajustaron textos, navegación, acentos del inicio, encabezados, acceso, perfil y paneles; las superficies de lectura usan tonos neutros. Se corrigió el ajuste de la etiqueta administrativa junto al logo en móvil.

Archivos: src/club.css, src/assets/club-field.svg y src/index.html (color del navegador). Verificación visual en inicio, catálogo móvil y administrador móvil. Compilación correcta sin advertencias de presupuesto con npm run build; carga inicial 498,57 kB. No hubo cambios de lógica ni se añadieron tests para esta modificación visual. Captura: screenshots/club-noviembre/neon-club.jpg.

Windows: npm run build; npm run start:emulators -- --port 4201 con emuladores iniciados. Siguiente paso: revisar el contraste de la versión neón en el teléfono.

## Tarjetas integradas al diseño neón

Se sustituyeron las superficies blancas y pastel por paneles verde oscuro con bordes verdes, texto claro y selección lima. El ajuste compartido cubre tarjetas de locales y canchas, tarifas, formularios, calendario, horarios, avisos y paneles administrativos. Se conserva el fondo blanco del QR para facilitar su lectura. Se eliminaron declaraciones CSS anteriores duplicadas, manteniendo la compilación dentro del presupuesto existente.

Archivos modificados: `src/club.css` y este documento. Evidencia añadida: `docs/screenshots/club-noviembre/tarjetas-neon.jpg`. No se cambió la lógica de reservas ni del backend.

Verificación: revisión visual de canchas de El Puma, calendario, catálogo móvil, administrador y superadministrador. El catálogo móvil no presenta desbordamiento horizontal (375 px de contenido y de área visible dentro del visor de 390 px). `npm run build` correcto, sin advertencias; carga inicial 499,16 kB. No se añadieron pruebas unitarias para este cambio de estilos.

Windows: `npm run start:emulators -- --port 4201` con los emuladores encendidos; `npm run build` para validar. Siguiente paso sugerido: revisar en un celular real el recorrido completo de reserva con el nuevo contraste.

## Dos temas y selector de apariencia — 3 de noviembre

Se añadió versión clara de fondo blanco y texto negro, conservando verde/lima como identidad, junto con la versión oscura existente. El botón accesible de sol/luna se muestra en el encabezado del cliente y administrador, y en la esquina superior del login y superadministrador. La elección persiste en este navegador y origen mediante `grassgo-theme`; si el almacenamiento está bloqueado, sigue siendo posible alternar durante la sesión. También se actualiza el color de la barra del navegador.

Archivos: `src/app/core/services/theme.service.ts`, `theme.service.spec.ts`, `src/app/shared/theme-toggle.ts`, `src/app/app.ts`, `src/app/app.html`, `src/index.html` y `public/assets/theme.css`. La hoja de apariencia se entrega como recurso estático, con selectores limitados al tema claro. Se añadieron ajustes de espacio al encabezado, etiquetas accesibles de los botones y contraste en formularios, agenda y paneles. No se filtran fotografías, logos ni QR. El visor local `.firebase/qa-club/index.html` ahora respeta el ancho elegido incluso cuando supera el panel visible del navegador, permitiendo medir tablet y escritorio correctamente.

Verificación: 26 pruebas Angular correctas en 8 archivos, incluyendo persistencia, alternancia y almacenamiento bloqueado. Inicio probado con anchos de visor 320, 390, 768 y 1280 px (áreas útiles de 305, 375, 753 y 1265 px, descontando la barra de desplazamiento), sin desbordamiento horizontal interno. Se revisaron visualmente catálogo, calendario, horarios, acceso móvil, administrador y superadministrador. Recarga conserva el tema claro. Captura: `docs/screenshots/club-noviembre/tema-claro.png`.

`npm run build` finaliza correctamente. Queda una advertencia de presupuesto: carga inicial 501,22 kB frente al objetivo de 500 kB; no se incrementó el límite. `public/assets/theme.css` se sirve por separado y no está incluido en ese total. No se ejecutaron pruebas de backend porque esta tarea no modifica sus operaciones.

Windows: `npm run start:emulators -- --port 4201` con emuladores encendidos; validar con `npm run build` y `npm test -- --watch=false`. Siguiente paso sugerido: revisar ambos temas en un teléfono físico y optimizar la pequeña diferencia del presupuesto inicial antes de publicar.

## Composición compartida entre temas

### Búsqueda como acción principal

Actualización posterior: el usuario prefirió volver a la posición original. Se retiró el recuadro superior y el acceso está otra vez dentro del anuncio deportivo, después de su descripción. Se amplió únicamente ese botón: ancho completo, 78 px de alto en escritorio y 72 px en móvil, texto grande y fondo lima en ambos temas. Archivos: `customer-home.ts` y `public/assets/theme.css`. Compilación y 33 pruebas Angular correctas; comprobación móvil sin desbordamiento a 320 px y captura en `docs/screenshots/club-noviembre/boton-original-ampliado.png`. Hosting actualizado. El backend alternativo está preparado y probado localmente, pero sigue pendiente de alojamiento; ver `BACKEND_GRATUITO_NODE.md`.

El inicio del cliente muestra «Buscar una cancha» inmediatamente después del saludo, antes del anuncio deportivo. El recuadro completo enlaza a `/sedes`, usa lima en ambos temas, icono de cancha y flecha. Se retiró el botón anterior del interior del anuncio para concentrar la acción en el acceso superior.

Archivos: `src/app/features/booking/customer-home.ts`, `public/assets/theme.css` y este documento. Compilación correcta, con la advertencia existente de presupuesto inicial (501,21 kB). Comprobación visual en 390 px y prueba de ancho en 320 px sin desbordamiento (305 px útiles); el acceso mide 108 px de alto y aparece entre 165 y 273 px del documento móvil. Al tocarlo se abre el catálogo `/sedes`. Captura: `docs/screenshots/club-noviembre/buscar-cancha-destacado.png`. No se añadieron pruebas unitarias para este ajuste visual. Hosting actualizado; no se publicó ningún cambio del backend en preparación.

Windows: `npm run start:emulators -- --port 4200` con emuladores activos, o `npm run build` para validar. Siguiente paso: continuar la adaptación Node del backend pendiente de la cuenta de alojamiento; las reservas online no se dan por habilitadas por este cambio visual.

Se corrigió la diferencia entre los patrones de fondo: ambos temas utilizan ahora el mismo SVG, tamaño y posición de franjas y líneas. El recurso compartido se entrega en `public/assets/club-field.svg`, a partir del SVG existente. La versión clara cambia únicamente los colores de las superficies; deja de añadir sombras propias a componentes que no las tenían en oscuro. Se ajustaron los fondos internos de fecha/hora, compartir, calificación y avisos de reservas para evitar bloques oscuros con texto oscuro en modo claro.

Archivos: `src/club.css`, `public/assets/theme.css`, `public/assets/club-field.svg` y este documento. Evidencia: `docs/screenshots/club-noviembre/reservas-temas-unificados.png`. Comprobación en navegador al alternar la tarjeta de reservas: mismos 560 px de ancho, 375,36 px de alto, radio de 24 px, espaciado de 28 px y fuente Manrope. Compilación correcta con `npm run build`; permanece la advertencia de presupuesto previa (501,21 kB frente a 500 kB). No se añadieron tests para este ajuste de colores y recurso de fondo.

Windows: `npm run start:emulators -- --port 4201` con emuladores encendidos; `npm run build` para validar. Siguiente paso: revisar ambos temas con el selector superior en el teléfono.
