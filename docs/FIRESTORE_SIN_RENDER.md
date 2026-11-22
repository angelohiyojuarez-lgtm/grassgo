# Adaptación directa a Firestore — primer incremento

> Actualización del 19 de noviembre: el recorrido cliente ya está conectado a Firestore,
> con foto privada y revisión manual. Ver [estado actual y comandos](CLIENTE_FIRESTORE.md).
> El texto de abajo conserva el registro histórico del primer prototipo; sus pendientes
> de conexión no describen el código actual. El Puma sigue sin habilitar cobros reales
> porque faltan horario y datos del propietario.

El usuario eligió mantener Firebase gratuito y prescindir de Render. Definió 15 minutos para que el administrador acepte una solicitud, antes de liberar el horario. La adaptación Node anterior queda como alternativa no desplegada; no se configuró una cuenta de Render ni se activó facturación.

## Implementado y comprobado localmente

`firestore.rules` incorpora un prototipo separado de las colecciones anteriores:

- `direct_requests/{id}`: solicitud privada con propietario, local, cancha, fecha/hora, timestamps, precio, adelanto y estados. Solo acepta campos definidos y verifica tarifas/horarios contra la configuración del local.
- `direct_slots/{local}/courts/{cancha}/days/{fecha}/hours/{hora}`: bloqueo de disponibilidad sin UID ni comprobante. Solicitud y bloqueo deben escribirse juntos. No admite extender el plazo con la hora del dispositivo.
- El bloqueo pendiente puede reemplazarse tras 15 minutos medidos desde `lockedAt`, que debe coincidir con la hora del servidor al crearlo. Una solicitud confirmada no se libera por ese plazo.
- Los clientes no pueden confirmar pagos ni reservas, alterar la identidad o escribir solicitudes aisladas. Local suspendido y cancha en mantenimiento bloquean nuevas solicitudes. El registro de la solicitud anterior se conserva al reutilizar un horario vencido.

`tests/direct-reservations.rules.test.mjs` contiene 8 pruebas correctas en emuladores: escritura atómica, concurrencia, falsificación de campos, reloj manipulado, reutilización al vencer, privacidad, protección de confirmados y suspensión/mantenimiento. Los errores PERMISSION_DENIED de intentos negativos son resultados esperados.

## Estado y pendientes

Este incremento NO conecta todavía el frontend a estas nuevas colecciones, NO permite aprobación administrativa ni envío de comprobantes y NO se desplegó a producción. No corrige por sí solo los errores online de Cloud Functions. Las reglas nuevas no deben publicarse como si el flujo estuviera completo.

Falta diseñar y validar las transiciones de comprobante, confirmación/rechazo y liberación; limitar abusos por usuario; conectar consultas y transacciones del cliente y administrador; preparar proyecciones públicas de locales y disponibilidad; adaptar medios privados sin Storage/Blaze; preservar inicio real, mantenimiento y calificaciones. Solo después se puede activar el modo Firestore en Hosting y preparar los datos de producción. No se debe abrir lectura de establecimientos privados para evitar crear la proyección pública.

Revisión de seguridad del prototipo: pruebas locales no sustituyen una revisión completa antes de compartir ampliamente. Aviso de la guía aplicada:

> I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for atomic slot holds, owner-only requests, field validation and tenant-scoped reads. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.

## Windows

Desde la raíz:

```powershell
node scripts/firebase-local.mjs emulators:exec --config firebase.test.json --project demo-grassgo-direct-tests --only firestore "node --test --test-concurrency=1 tests/direct-reservations.rules.test.mjs"
```

Archivos modificados: `firestore.rules`, la prueba anterior y este documento. Siguiente incremento: comprobante y revisión del administrador, con pruebas negativas de permisos y concurrencia, antes de habilitar escrituras del flujo en la interfaz.
