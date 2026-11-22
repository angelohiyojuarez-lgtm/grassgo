# GrassGo — Fundación Angular y Firebase

> Este documento registra la primera entrega. El estado más reciente, las nuevas rutas de acceso, el recorrido de reservas, comprobantes, backend y pruebas están en [Recorrido celeste](RECORRIDO_CELESTE.md).

## Alcance de esta entrega

Aplicación Angular standalone con rutas lazy, diseño responsive desde 320 px,
inicio, catálogo, presentación del piloto, registro, login, recuperación, perfil
privado y guardas para áreas de cliente, administrador y superadministrador.
El SDK modular Firebase reemplaza AngularFire incompatible con Angular 22.

El código anterior sigue en raíz, public/, src/ y _trash_temp/. Los recursos publicados
se limitan a public/assets/ y favicon.ico: los HTML y scripts antiguos ya no se sirven.
Los archivos sobrescritos tienen respaldo local en legacy/pre-angular-foundation/.
Los documentos maestros se extrajeron del ZIP sin alterar su contenido.

## Organización

```text
src/app/
  core/auth/        identidad, errores, permisos y guardas
  core/firebase/    Auth inicial y carga diferida de Firestore
  core/models/      contratos de usuario, membresía y catálogo
  core/services/    perfil privado y catálogo publicado
  features/auth/   login, registro y recuperación
  features/profile/
  features/discovery/
  features/workspace/  estados explícitos de funciones todavía no habilitadas
  shared/          iconos SVG locales, sin CDN
src/theme.css      estilos responsive y accesibilidad
tests/            pruebas de autorización ejecutadas en Firestore Emulator
```

## Identidad y permisos

- Firebase Authentication es la única fuente de identidad. Nunca se crea una
  sesión local alternativa cuando falla Firebase.
- Se eliminan las dos claves antiguas de contraseñas/sesión al iniciar la aplicación.
  No se importan cuentas offline. Sus usuarios deben crear una cuenta real.
- El correo de acceso pertenece a Auth y no se modifica mediante el formulario del perfil.
- profiles/{uid} solo guarda uid, displayName, phone y timestamps de servidor.
- El cliente puede tener membresías administrativas en varios establecimientos.
- platform_roles/{uid} contiene el privilegio global; el cliente no puede escribirlo.
- users/{uid}/memberships/{id} es un índice de navegación mantenido por servidor;
  el acceso se vuelve a comprobar contra establishments/{id}/members/{uid}.
- Reglas de Firestore son la autorización efectiva; las guardas son una ayuda de navegación.
- No se habilitan todavía altas administrativas ni escrituras operativas de establecimientos.
  Se implementarán mediante backend privilegiado con auditoría y validaciones.
- Storage queda cerrado mientras no se implemente el flujo de archivos.

El catálogo cloud requiere sesión en esta entrega y consulta status == published,
limitado a 30 elementos. La presentación pública de El Puma es contenido de demostración
identificado como tal, sin disponibilidad ni precio inventado. Habilitar catálogo cloud
anónimo con datos exclusivamente públicos será una decisión del próximo incremento.

## Seguridad validada localmente

16 escenarios de reglas: propietario, visitante, lectura cruzada, superadmin sin
acceso a PII, inyección de rol/contraseña, tipos/tamaños, campos obligatorios,
UID y createdAt inmutables, timestamps, aislamiento entre tenants, asignaciones,
suspensiones, índice falso, subcolecciones huérfanas, filtro de catálogo y bloqueo
de rutas antiguas/reservas/pagos. Casos de stock, pagos, transiciones y contadores
no aplican aún: las escrituras de esos módulos se deniegan completamente.
9 pruebas de identidad y guardas verifican fallos de red/credenciales, ausencia de
fallback local, cierre fallido y denegación de rutas administrativas.

Verificación en navegador con cuenta ficticia en emuladores: registro, guardado del
perfil, rechazo de superadministración y contraseña incorrecta, cierre de sesión.
Revisión visual en marcos de 390 px (inicio) y 320 px (login), además de escritorio.
Compilación estricta TypeScript y plantillas Angular habilitada. Carga inicial de
producción: aproximadamente 393 kB sin comprimir (106 kB de transferencia estimada);
Firestore y las pantallas se cargan por demanda.

`npm audit --omit=dev`: cero vulnerabilidades al cierre de esta entrega.
Quedan cinco avisos moderados en dependencias de herramientas Firebase de desarrollo
(OpenTelemetry/uuid y sus dependientes). No se aplicaron degradaciones mayores forzadas.
Se aplicaron overrides de parches compatibles para gRPC y Vite y se repitieron build
y pruebas. No se considera esta auditoría una garantía de seguridad completa.

Reglas prototipo, pendientes de revisión antes de abrir al público:
I've set up prototype Security Rules to keep the data in Firestore safe. They are
designed to be secure for private profiles and establishment isolation. However,
you should review and verify them before broadly sharing your app. If you'd like,
I can help you harden these rules.

## Proyecto remoto

Se conserva la configuración web existente grassgoo. La clave pública web Firebase
no es una credencial de administración; la protección depende de Auth y las reglas.
No hay claves privadas ni cuentas de servicio añadidas.

La CLI no tiene una sesión autorizada. No se pudo identificar la edición de Firestore
remoto ni revisar sus reglas actuales. NO se desplegaron reglas ni se modificaron
usuarios remotos. El emulador usado es Standard; antes del despliegue hay que identificar
la instancia remota, revisar impacto sobre datos heredados y autorizar la activación.
No desplegar estas reglas a ciegas sobre consumidores de la aplicación antigua.

## Windows: ejecutar

```powershell
npm install
npm start
```

Abrir http://localhost:4200/. Las antiguas direcciones .html redirigen a rutas Angular.
El registro/login cloud requieren Email/Password habilitado en el proyecto.
El perfil y catálogo requieren las nuevas reglas revisadas y desplegadas.
Un error de permisos se muestra explícitamente; no se simula un guardado exitoso.

Modo de pruebas aislado (dos terminales):

```powershell
# Terminal 1: requiere Java 21 o superior.
npm run emulators
# Terminal 2
npm run start:emulators -- --port 4201
```

Abrir http://localhost:4201/. Proyecto demo-grassgo, sin acceso a producción.
El wrapper scripts/firebase-local.mjs busca JAVA_HOME y, en Windows, el JRE portátil
de esta máquina bajo LOCALAPPDATA/GrassGo/tools/jre21. No cambia variables globales.
Los correos de verificación/recuperación del emulador se muestran en su terminal,
no se envían a buzones reales. Los usuarios son temporales y desaparecen al reiniciar.

```powershell
npm run build
npm test -- --watch=false
npm run test:rules
npm audit --omit=dev
```

## Próximas entregas pequeñas

1. Verificar Firebase remoto, reglas y proveedores; completar pruebas del entorno real.
2. Definir alta por invitación o solicitud aprobada, bootstrap seguro del superadmin y
   asignación de administradores con auditoría. No se asume una política comercial.
3. CRUD de establecimientos y canchas con permisos, publicación y datos del piloto validados.
4. Motor de disponibilidad y reservas en servidor con exclusión de cruces y reintentos.
5. Comprobantes privados, pagos manuales realmente verificados, cancelaciones e inicio real.
6. Quiosco, inventario, caja e informes. Planes y suscripciones después de definir el negocio.

Siguen sin fijarse tarifas, adelanto, vencimientos, política de devoluciones ni canales
externos. Estos puntos requieren decisión del propietario antes de programarlos.
