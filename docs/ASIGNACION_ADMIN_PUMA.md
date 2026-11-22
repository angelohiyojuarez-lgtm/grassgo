# Responsable de Grass El Puma — 19 de noviembre de 2026

Por solicitud explícita del usuario se vinculó la cuenta existente
`angelohiyojuarez@gmail.com` como administrador activo de `el-puma` en el proyecto
Firebase `grassgoo`.

Se comprobó que la cuenta existe y está activa. Se creó el registro privado de
Grass El Puma en estado `approved`, con motor directo y reservas deshabilitadas,
porque anteriormente solo existía su ficha de catálogo. No se inventaron
horarios, datos de pago ni canchas operativas.

La asignación se guardó atómicamente en la membresía canónica
`establishments/el-puma/members/{uid}`, el índice de navegación
`users/{uid}/memberships/el-puma`, el responsable del establecimiento y una entrada
de auditoría. La lectura posterior confirmó rol `admin` y estado `active` en ambos
documentos. Los privilegios globales conservaron su estado anterior.

El correo de la cuenta está pendiente de verificación. Esto no impide el acceso
administrativo actual; debe verificarse antes de la publicación operativa según
la validación existente. No se cambió el atributo `emailVerified`.

## Verificar en Windows

Desde PowerShell:

```powershell
Start-Process 'https://grassgo.web.app/admin/ingresar'
```

Si aparece la sesión de esa cuenta, pulsar **Continuar**. Los permisos se consultan
en Firestore, por lo que no es necesario crear otra cuenta ni cambiar contraseña.
Si la pantalla ya estaba abierta, recargarla primero.

Validación: cuenta activa y asignación comprobadas mediante API administrativa y
lectura posterior de los documentos. No hubo cambios al código de la aplicación;
no se volvieron a ejecutar sus suites para esta modificación de datos.

Siguiente paso: completar el panel del negocio para configurar sus horarios y
datos reales de pago antes de habilitar reservas de clientes.
