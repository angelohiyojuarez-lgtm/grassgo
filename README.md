> Actualización del administrador: [inicio real, horarios y configuración del local](docs/ADMINISTRACION_Y_INICIO_REAL.md).

> Estado del 19 de noviembre: [recorrido del cliente con Firestore, comprobantes y pruebas](docs/CLIENTE_FIRESTORE.md).

> Panel del local: [botones grandes, navegación sencilla y revisión guiada](docs/ADMIN_FACIL.md).

> Mi local: [editar horarios y cerrar/reabrir fechas](docs/HORARIOS_Y_CIERRES.md).

> Nuevo: [el dueño edita su celular, descripción y QR de pago](docs/DATOS_Y_QR_DEL_LOCAL.md).

> Operación del 20 de noviembre: [horarios en vivo, precios e inicio con finalización automática](docs/PRECIOS_HORARIOS_Y_PARTIDOS.md).

> Superadmin: [negocios reales, contadores, preparación y cambios de estado conectados](docs/SUPERADMIN_CONECTADO.md).

> Flujo conectado: [alta, invitaciones, publicación, operación y avisos con sonido](docs/FLUJO_UNIDO_Y_AVISOS.md).

> Canchas: [fútbol y vóley en un mismo negocio, con tarifas editables por dueño y superadmin](docs/MULTICANCHAS_Y_TARIFAS.md).
>
> Kiosko: [productos, stock, ventas e ingresos separados y combinados](docs/KIOSKO_E_INGRESOS.md).

# GrassGo

Plataforma multiestablecimiento de canchas sintéticas, desarrollada con Angular y Firebase.

## Ejecutar

```powershell
npm install
npm start
```

Abre http://localhost:4200/. Para probar sin tocar datos reales usa los emuladores.

[Arquitectura, estado real, pruebas e instrucciones para Windows](docs/ARQUITECTURA_Y_AVANCE.md).

Estado actual: [Recorrido móvil celeste, reservas y comprobantes en emuladores](docs/RECORRIDO_CELESTE.md).

Última entrega: [Alta, configuración y publicación de negocios, fotos, vóley y tarifas](docs/ALTA_NEGOCIOS_OPERATIVA.md).

Ajuste más reciente: [Portada del establecimiento y datos que verá el cliente](docs/PORTADA_Y_DATOS_CLIENTE.md).

El recorrido cliente de reservas y comprobantes utiliza Firestore directamente. El panel del local permite consultar agenda, revisar comprobantes manualmente, editar horarios/cierres y guardar contacto, descripción, referencia y foto de QR. El Puma todavía necesita sus horas reales, canchas operativas y datos de pago para habilitar solicitudes; los datos de demostración no sirven para pagar.
