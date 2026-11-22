# Calificaciones después del partido

El cliente puede puntuar al establecimiento de 1 a 5 estrellas desde **Mis reservas**, después de que el administrador marque el partido como finalizado. En esta entrega se guarda una calificación por reserva, sin comentarios ni edición posterior. Los reintentos con la misma puntuación son idempotentes.

## Seguridad y almacenamiento

`rateEstablishment` exige autenticación, propiedad de la reserva, estado confirmado, adelanto verificado y servicio finalizado con una hora de término pasada registrada por el servidor. Recibe únicamente reservationId y stars; deduce el establecimiento desde la reserva. No acepta un tenant ni un cliente elegidos por el navegador.

La transacción guarda `reservations/{id}.rating`, actualiza `establishments/{id}.ratingSummary` (sum/count/average) y genera eventos de auditoría. Los clientes no tienen escritura directa en estos documentos; se conserva el bloqueo de firestore.rules. El catálogo solo devuelve el promedio y la cantidad de votos, sin identidad ni comprobantes.

Las reservas con demo=true alimentan exclusivamente demoRatingSummary. Ese promedio se muestra con la marca PRUEBA solo en el backend local; nunca sustituye puntuaciones reales ni se expone desde el backend de producción.

## Archivos

- Backend: functions/ratings-api.js, index.js, booking-api.js, business-api.js y tests/ratings-api.test.mjs.
- Cliente: shared/reservation-rating.ts y sus pruebas; my-reservations.ts; modelos booking.ts y business-catalog.service.ts; venues.ts, courts.ts y sport.css.
- package.json incluye las pruebas de calificación en test:integration.
- scripts/demo-rating-reservation.mjs crea, solo en demo-grassgo local, un partido SIMULADO finalizado para equipo@grassgo.test. No altera las reservas existentes ni representa un pago o partido real.

## Verificación y Windows

Compilación correcta; 23 pruebas Angular y 48 pruebas backend de reservas, configuración, operación y calificaciones aprobadas (las 6 de calificaciones se ejecutaron de nuevo tras añadir el caso del catálogo). No se modificaron reglas ni se desplegó a producción.

Con el emulador Firestore ya activo en 8080:

```powershell
npm run build
npm test -- --watch=false
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
node --test --test-concurrency=1 functions/tests/ratings-api.test.mjs functions/tests/booking-api.test.mjs functions/tests/business-api.test.mjs functions/tests/operations-api.test.mjs
node scripts/demo-rating-reservation.mjs
```

Los tests backend usan proyectos de prueba independientes y no borran demo-grassgo. Se verificó también que la nueva función callable está disponible y rechaza votos sin reserva propia.

Revisión visual: /reservas muestra el formulario solo en el partido simulado finalizado; seleccionar estrellas habilita Enviar calificación. Captura: screenshots/calificar-local.jpg. Se dejó el voto sin enviar para que el usuario pueda probarlo.

Siguiente paso: probar el envío desde el teléfono y comprobar el promedio de PRUEBA en Explorar canchas; cuando se prepare producción será necesario desplegar la nueva función y las funciones actualizadas.
