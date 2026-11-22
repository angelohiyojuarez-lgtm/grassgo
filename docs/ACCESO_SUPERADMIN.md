# Acceso de superadministración — 20 de noviembre de 2026

Por solicitud expresa del responsable del proyecto se añadió el permiso global
de superadmin a la cuenta existente `angelohiyojuarez@gmail.com` en `grassgoo`.
Su membresía como administrador de El Puma se conserva.

El mensaje «Esta cuenta no tiene permisos de superadministración» se debía a que
no existía `platform_roles/{uid}` para esa identidad. El acceso comprueba ese
documento y exige `role: superadmin` y `status: active`, independientemente de las
membresías de establecimientos. No utiliza custom claims.

Se comprobó la identidad mediante Firebase Authentication y se guardaron el rol
y su auditoría en un único commit administrativo con precondiciones. La lectura
posterior confirmó el rol activo y que ambos documentos de membresía de El Puma
conservaron sus fechas de actualización. No se modificaron credenciales,
verificación de correo, reglas de seguridad ni datos del negocio.

Validación en producción: con la sesión existente de esa cuenta, el botón
**Continuar** permitió navegar a `/superadmin/inicio`. Desapareció la denegación
de superadministración. La pantalla mostró «No pudimos consultar los negocios»;
ese error de conexión del panel es un pendiente distinto del permiso corregido.

## Comprobar desde Windows

```powershell
Start-Process 'https://grassgo.web.app/superadmin/ingresar'
```

Con esa cuenta iniciada, pulsar **Continuar**; si la pantalla conserva el mensaje
anterior, recargar antes. No hace falta crear otra cuenta ni cambiar contraseña.

La consulta administrativa reproducible, sin escrituras, es:

```powershell
node scripts/assign-pilot-superadmin.mjs
```

El script está restringido al proyecto, correo y UID autorizados. Requiere una
sesión administrativa de Firebase CLI con permisos reales; no se distribuye al
navegador. Su opción `--apply` realiza la asignación únicamente si falta el rol
activo y guarda previamente un respaldo local en `.firebase/`, excluido de Git.
No se debe usar este script para otras cuentas. La sintaxis se verificó con:

```powershell
node --check scripts/assign-pilot-superadmin.mjs
```

## Alcance y siguiente paso

La corrección del rol habilitó la entrada. El incremento posterior
[Superadmin conectado](SUPERADMIN_CONECTADO.md) conecta resumen, negocios,
actividad y cambios de estado al mismo Firestore de cliente y dueño. El alta,
la asignación de nuevos dueños y la publicación operativa siguen pendientes.
