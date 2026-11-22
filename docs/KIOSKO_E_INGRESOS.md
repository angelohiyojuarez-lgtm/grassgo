# Kiosko e ingresos del establecimiento

El administrador usa su misma cuenta y su panel habitual. Se añaden dos botones
grandes: **Mi kiosko** y **Mis ingresos**. El superadmin dispone de las mismas
pantallas desde **Negocios → Ver ficha → Kiosko: productos y ventas** o
**Ingresos de canchas y productos**. No se crean cuentas de empleados.

## Productos y ventas

1. Abrir **Mi kiosko → Productos y stock → Agregar producto**.
2. Introducir nombre, categoría opcional, precio por unidad, costo de compra
   opcional y cantidad inicial real. Los importes admiten céntimos.
3. Usar **Reponer** para añadir unidades. La edición de nombre, precio o costo
   conserva la cantidad disponible. Desactivar un producto conserva su historial.
4. En **Vender**, elegir el producto, indicar cantidad y método: efectivo, Yape
   o Plin. Confirmar que el dinero se recibió antes de registrar la venta.
5. Consultar **Movimientos** para ver las últimas treinta operaciones.

La venta rápida registra un producto con una o varias unidades. Si se venden
productos diferentes, se registra cada producto. Es un registro interno de
ventas: no genera boletas ni facturas ni realiza cobros por internet.

El stock y su movimiento se guardan en la misma transacción. Dos personas no
pueden vender la última unidad a la vez. Los reintentos conservan su operación
para no duplicar ventas. El precio y costo se copian del producto guardado y
quedan en el historial de la venta; editarlos después no altera ventas anteriores.

Un costo vacío significa **desconocido**, no cero. Si se registra cero de forma
explícita, se conserva como costo cero. El costo es el valor unitario indicado
al vender; no se aplica una política de valoración por lotes o promedios.

### Foto opcional del producto

El administrador y el superadmin pueden adjuntar, cambiar o quitar una foto
desde el mismo formulario de producto. No es necesaria para guardar o vender.
La foto aparece en las tarjetas de venta, inventario y producto seleccionado.

Se usa el método **Base64** confirmado por el usuario: el navegador comprime
la foto a JPEG y devuelve un texto `data:image/jpeg;base64,...`. Ese texto
contiene la imagen y se guarda en el producto de Firebase; no es un enlace a
un servidor externo. No requiere otra cuenta ni activar Cloud Storage.

Se aceptan archivos JPG, PNG o WebP de hasta 5 MB. Se comprueba su cabecera y
decodificación, se conserva la proporción completa y se reduce el lado mayor
a un máximo de 960 píxeles. La imagen preparada no supera 180000 caracteres.
Una imagen inválida muestra un mensaje; siempre se puede guardar sin foto.

El campo `photo` es opcional para los productos anteriores y admite `null`
para quitar la foto. Solo el alta o la edición pueden cambiarla. Vender o
reponer conserva la foto y mantiene el funcionamiento del stock y los permisos.
Los movimientos guardan sus importes y datos del producto sin duplicar la
imagen, y no se modifican las ventas anteriores.

## Día, semana y mes

En **Mis ingresos**, elegir **Día**, **Semana** o **Mes** y una fecha. La semana
va de lunes a domingo y el mes corresponde al calendario. Todos los intervalos
usan la zona horaria de Lima. La pantalla permite consultar fechas anteriores
y se actualiza cada treinta segundos mientras está abierta.

Se muestran por separado:

- **Ingresos de canchas:** adelantos ya verificados y saldos realmente recibidos.
- **Ventas de productos:** importe de las ventas registradas como cobradas.
- **Total cobrado del local:** suma de los dos ingresos anteriores.
- **Ganancia bruta de productos:** ventas menos el costo de las unidades
  vendidas, con aviso de resultado parcial si hubo ventas sin costo registrado.
- Productos vendidos, cantidades y detalle de las ventas del periodo.

El total cobrado es ingreso, no utilidad neta. Para calcular la ganancia neta
del alquiler todavía haría falta llevar los gastos del local. El costo actual
de un producto no se aplica retroactivamente a ventas con costo desconocido.

Los importes se agrupan por la fecha real del cobro. Una reserva futura puede
tener un adelanto cobrado hoy. El precio total contratado no se suma al adelanto.
Los **Saldos de canchas por cobrar** corresponden a las reservas de las fechas
elegidas. Al recibir el saldo completo se registra el cobro con fecha de hoy,
seleccionando el método y confirmando la recepción. Un saldo registrado dos
veces se cuenta una sola vez.

## Datos y permisos

Los productos y sus movimientos permanecen privados bajo el establecimiento:

- `establishments/{id}/kiosk_products/{productId}`
- `establishments/{id}/kiosk_movements/{operationId}`
- `establishments/{id}/court_income/{reservationId}`

La membresía canónica del administrador o el rol global activo del superadmin
se comprueban en Firestore. Las ventas y reposiciones requieren un local activo
con motor directo. Los clientes y administradores de otros establecimientos no
pueden consultar o cambiar estos datos. El registro de ingresos de cancha evita
exponer al superadmin fotografías de comprobantes y datos privados de clientes.

Confirmar manualmente un comprobante crea también su ingreso de adelanto en el
mismo commit. Se mantienen separados el cobro del adelanto y el saldo. No se
verifican pagos por el simple hecho de recibir una imagen.

## Históricos y ejecución en Windows

La migración deriva los ingresos de reservas cuyo adelanto **ya estaba
verificado**. Conserva el importe, autor y fecha de esa revisión. No verifica
comprobantes nuevos ni cambia reservas. Si ya existe un ingreso no lo sobrescribe.

```powershell
npm run test:kiosk
npm run test:kiosk-photos
npm run build

# Solo consulta; no modifica datos.
node scripts/backfill-court-income.mjs

# Deriva los registros faltantes de adelantos previamente verificados.
node scripts/backfill-court-income.mjs --apply

Start-Process 'https://grassgo.web.app/admin/inicio'
Start-Process 'https://grassgo.web.app/superadmin/negocios'
```

La validación focal reúne diez casos: cinco Angular y cinco de reglas. Incluye
aislamiento, stock concurrente, importes históricos, costos desconocidos,
reintentos, adelantos, saldos y totales de varias páginas. No requiere Functions,
un plan Blaze ni índices compuestos nuevos.

Archivos principales: modelos `kiosk.ts` y `business-income.ts`; servicios
`kiosk.service.ts`, `business-income.service.ts` y conexión del adelanto en
`direct-booking.service.ts`; pantallas `admin-kiosk.*`, `admin-income.*`, paneles
local y superadmin; `firestore.rules`, pruebas focales y script de migración.

## Verificación de la entrega — 22 de noviembre de 2026

- Cinco casos Angular y cinco casos de reglas aprobados. No se ejecutó la
  batería general de pruebas.
- Compilación de producción correcta, con los avisos de tamaño ya existentes
  del bundle inicial y estilos del panel local.
- Reglas y Hosting publicados en `grassgo.web.app`; la versión servida coincide
  con la compilación local y mantiene HTML sin caché.
- Consulta de migración real: cero reservas con adelanto verificado, cero
  registros pendientes y cero errores; no hizo falta aplicar escrituras.
- Revisión visual en la cuenta del admin: productos/costo/stock, periodos y
  resumen mensual. Revisión del superadmin: ambos accesos cargan los mismos
  datos del negocio sin errores de permisos.
- No se añadieron productos, ventas ni cobros ficticios en producción.

Se actualizaron también los lotes de confirmación de cuatro fixtures anteriores
para incluir el ingreso del adelanto en el mismo commit. Su sintaxis se comprobó
sin ejecutar casos adicionales. Las fixtures antiguas de alta de negocio de
`platform-connected-flow` todavía requieren su adaptación a la entrega previa
de multicanchas; no forman parte de estos diez casos.

Capturas: [formulario de producto](screenshots/kiosko-admin-producto.jpg) y
[resumen mensual](screenshots/kiosko-ingresos-admin.jpg).

### Ampliación de fotos opcionales

- Diez casos focales aprobados: siete Angular y tres de reglas para fotos,
  incluidos los flujos anteriores de venta y reposición. Compilación correcta.
- Foto Base64 publicada en ambos paneles, sin configurar proveedores externos.
- Vista previa real comprobada en admin y superadmin con un recurso del propio
  proyecto: JPEG de 960 × 960 y 84291 caracteres, por debajo del máximo.
- Se quitaron las vistas previas al terminar; no se guardaron productos ni
  fotografías de prueba en la base de producción.
- Se comprobó que las ventas y movimientos no duplican la foto ni cambian
  importes históricos, y que los productos anteriores funcionan sin foto.

[Vista previa de foto opcional en superadmin](screenshots/kiosko-foto-opcional-superadmin.jpg).
