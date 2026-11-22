export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'El correo o la contraseña no son correctos.';
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con este correo. Prueba iniciar sesión.';
    case 'auth/invalid-email':
      return 'Revisa el formato de tu correo electrónico.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'La contraseña no cumple los requisitos de seguridad del proyecto.';
    case 'auth/too-many-requests':
      return 'Hubo muchos intentos. Espera unos minutos y vuelve a probar.';
    case 'auth/network-request-failed':
      return 'No pudimos conectar con el servicio de acceso. Vuelve a intentarlo.';
    case 'unavailable':
      return 'El servicio de datos no está disponible en este momento. Inténtalo nuevamente en unos minutos.';
    case 'permission-denied':
      return 'No pudimos acceder a los datos. Verifica la configuración de permisos del proyecto.';
    case 'auth/operation-not-allowed':
      return 'El acceso por correo aún no está habilitado en este proyecto.';
    default:
      return 'No pudimos completar la operación. Vuelve a intentarlo.';
  }
}
