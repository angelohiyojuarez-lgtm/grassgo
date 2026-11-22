# GRASSGO — CONTEXTO MAESTRO PARA CODEX

**Versión del contexto:** 1.0 — 23 de octubre de 2026  
**Estado:** Documento de visión, requisitos y guía de implementación. NO presupone que las funciones ya estén programadas.

## 1. Tu papel como Codex

Actúa como arquitecto y desarrollador senior full-stack. Primero **inspecciona el repositorio real**, identifica el stack, los archivos, los diseños, las dependencias y qué funciona actualmente. **No afirmes que algo está implementado sin haberlo comprobado.** Conserva lo existente; no reestructures ni elimines archivos sin explicar por qué. Propón un plan incremental, impleméntalo por etapas, ejecuta pruebas y comunica al usuario en español sencillo qué cambiaste, cómo probarlo y qué falta. Si un dato del negocio o una decisión técnica es indispensable y no está definida, consulta al usuario en vez de inventarla.

## 2. Identidad y visión del producto

**Nombre:** GrassGo.  
**Concepto:** Plataforma web estilo marketplace de canchas de grass sintético: los clientes descubren establecimientos, comparan opciones, consultan disponibilidad y reservan; cada establecimiento administra su operación; un superadministrador gestiona toda la plataforma. Inspiración de experiencia: un «Airbnb de canchas», pero enfocado en reservas deportivas y administración de negocios.

**Negocio piloto:** Grass El Puma, sector Salinas, Andahuaylas, Apurímac, Perú. Tiene una cancha sintética y un quiosco. El primer piloto debe poder trabajar con una cancha, pero la arquitectura debe soportar muchos establecimientos y múltiples canchas por establecimiento.

**Origen del proyecto:** trabajo académico de análisis y diseño, anteriormente limitado al piloto Grass El Puma y dos roles. **La visión actual del producto amplía el alcance a multiestablecimiento y añade superadmin.** Las funciones nuevas son propuestas: no atribuirlas a respuestas reales de entrevistas ni incluirlas como implementadas en el informe antiguo.

## 3. Estado real conocido

Solo consta que el usuario ha diseñado o comenzado dos interfaces: (1) inicio de sesión y (2) home/selección de cancha, fecha y horario. **No se ha confirmado qué código, backend, base de datos, integración de pagos o APIs existen.** Revisar el repositorio antes de tomar decisiones. Se han utilizado o considerado Google Stitch y Figma para diseño. No tratar mockups como funcionalidades terminadas.

## 4. Principios y alcance

- Plataforma **multi-tenant**: cada establecimiento es un tenant, con datos operativos aislados.
- Un establecimiento puede tener una o varias canchas; Grass El Puma inicia con una.
- Los clientes pueden reservar en diferentes establecimientos desde una misma cuenta.
- Interfaz en español, enfoque móvil primero, moneda PEN (S/), zona horaria `America/Lima` para mostrar fechas y reservas del piloto; fechas guardadas con tratamiento correcto de zona horaria.
- No confundir «solicitud de reserva», «reserva confirmada», «adelanto declarado», «comprobante enviado» y «pago realmente verificado».
- El marketplace, la administración y el quiosco pueden desarrollarse por fases, pero el modelo de datos inicial debe permitir la expansión.
- Mantener simplicidad operativa y costos reducidos durante el piloto.

## 5. Roles y permisos

### 5.1 Cliente

- Registrarse, iniciar/cerrar sesión, recuperar contraseña, editar perfil.
- Explorar y buscar establecimientos por ubicación; ver fotografías, información, canchas, precios, servicios y reglas.
- Ver calendario, fechas, horarios disponibles, duración, precios y estado de disponibilidad.
- Solicitar reserva, obtener instrucciones del adelanto, subir comprobante cuando corresponda, consultar estado e historial.
- Cancelar según políticas del establecimiento/plataforma; no asumir modificación o reembolso automático hasta definir reglas.
- Recibir notificaciones de confirmación/rechazo/cambios (según canales implementados).

### 5.2 Administrador del establecimiento

- Administrar solo los establecimientos a los que haya sido asignado.
- Configurar descripción, fotos, ubicación, horarios de atención, canchas, disponibilidad, bloques, mantenimiento, precios y políticas.
- Administrar solicitudes y reservas: verificar disponibilidad, revisar comprobantes, confirmar/rechazar, registrar pagos realmente percibidos, cancelaciones, inicio real y término de partidos.
- Gestionar quiosco: productos, categorías, inventario, movimientos, ventas y ajustes con historial.
- Registrar gastos, consultar ingresos por reservas y quiosco, hacer cierre diario de caja y reportes mensuales sin duplicar montos.
- En una fase posterior: gestionar empleados/roles de operador y permisos dentro del establecimiento. No dar acceso transversal a otros establecimientos.

### 5.3 Superadministrador GrassGo

- Panel global con indicadores agregados (establecimientos, canchas, usuarios, reservas, suscripciones, actividad).
- Aprobar, suspender o desactivar establecimientos y gestionar administradores asignados.
- Gestionar configuración global, planes y suscripciones (una vez definidos), incidencias y auditoría.
- Soporte y moderación con acciones trazables.
- **No debe poder hacerse superadmin por un campo enviado desde el frontend.** Alta/privilegios mediante mecanismo seguro del servidor.
- Acceso a información sensible de negocios solo según permisos, propósito y auditoría; minimizar exposición de datos personales.

### 5.4 Autorización

RBAC con comprobación en backend y aislamiento por `establishment_id`/tenant en todas las operaciones privadas. Un cliente ve sus propias reservas; un administrador ve las de sus establecimientos; superadmin tiene funciones globales estrictamente controladas. Prohibido depender solo de ocultar botones en la UI.

## 6. Módulos funcionales

### 6.1 Marketplace / descubrimiento

Home con buscador y tarjetas de establecimientos, fotos, ubicación, servicios, precios orientativos, estado de publicación y detalle de cada cancha. Mostrar solamente locales aprobados/publicados. Filtros iniciales según datos disponibles; mapa opcional para fases posteriores.

### 6.2 Autenticación

Registro, acceso, recuperación, perfil, sesiones y protección por rol. Si se elige autenticación con proveedor externo, no mezclar modelos inconsistentes.

### 6.3 Gestión de establecimientos y canchas

CRUD seguro, varias canchas por establecimiento, imágenes, horarios, tarifas por cancha y franjas, pausas/bloqueos, reglas de tiempo y cancelación. Separar `establishment` de `court`.

### 6.4 Motor de reservas

- Consultar disponibilidad real de una cancha en una fecha.
- Seleccionar slot (inicialmente 1 hora, **configurable**).
- Revalidar disponibilidad **del lado del servidor**, crear solicitud con un estado definido y proteger contra reservas superpuestas por concurrencia.
- Mantener estados bien definidos, por ejemplo: `pending_payment`, `pending_verification`, `confirmed`, `rejected`, `cancelled`, `completed`, `expired`; ajustar según decisiones del producto, no mezclar pagos con estados de reserva.
- Configurar plazo de vencimiento de solicitud no pagada y política frente a coincidencias; estos detalles necesitan aprobación del usuario.
- Para Grass El Puma se había propuesto adelanto de **S/ 10** por Yape/Plin y comprobante revisado manualmente por administrador. Debe ser configuración por establecimiento, no regla universal de todos los tenants. **No es una pasarela automática**.
- Se había propuesto impedir cancelaciones cuando falten menos de **5 horas** del inicio. Reglas de devolución, excepciones, cambios y responsable de procesar el reembolso deben definirse; no automatizar reembolsos sin especificaciones.
- El usuario mencionó problema de inicios tardíos: un partido reservado a las 20:00 comienza a las 20:20, termina a las 21:20 y retrasa la siguiente reserva. El administrador debe poder marcar «ya inició» y registrar hora real; proponer tiempo estimado de liberación y mostrar advertencia sin modificar unilateralmente reservas confirmadas. Evaluar reglas de buffers/preparación y conflictos.
- **Decisión explícita del usuario — 20 de noviembre de 2026:** en el piloto, el dueño pulsa **Empezar partido** y el partido finaliza automáticamente al cumplirse **60 minutos desde el inicio real**. No mostrar botón **Finalizar partido** ni exigir cierre manual. Conservar las horas originalmente reservadas y mostrar estimaciones actualizadas para los siguientes turnos. Este cierre del servicio no verifica pagos.
- Guardar registro de cambios y autor de cada transición.

### 6.5 Comprobantes y pagos

Registrar monto esperado, método, transacción o referencia si aplica, comprobante almacenado de forma privada, revisión humana y pagos efectivos. No marcar pagado solo por haber subido imagen. Validar tipo, tamaño y permisos de archivo; evitar URLs públicas permanentes cuando no correspondan. Permitir varios movimientos (adelanto, saldo, devoluciones) para conciliar.

### 6.6 Quiosco e inventario

Productos y precios por establecimiento, stock y movimientos (entrada, venta, ajuste), ventas con líneas y método de pago. Proteger contra stock negativo según política. Las ventas son independientes de las reservas, pero agregables en reportes.

### 6.7 Administración y reportes

Gastos, movimientos de caja, cierres diarios, ingresos verificados por alquiler, ingresos por quiosco, totales mensuales y ocupación. **No sumar el total de una reserva y su adelanto como ingresos separados.** Separar estado de cobro de estado de servicio. Es una gestión operativa simple, **no contabilidad fiscal integral**.

### 6.8 Planes y suscripciones (fase posterior, ahora sí dentro de la visión)

Superadmin administra planes y suscripciones de establecimientos, límites/configuración y vigencia. Antes de implementar, definir modelo comercial: precio, periodicidad, pruebas, comisiones, impagos, cancelaciones y quién cobra. No inventar tarifas ni conectar facturación real sin aprobación.

### 6.9 Notificaciones (por fases)

Notificaciones in-app de solicitud, comprobante recibido, confirmación, cancelación y recordatorios. WhatsApp, correo o push como integraciones futuras sujetas a credenciales, costos y consentimiento.

## 7. Flujo principal de reserva

1. Cliente crea cuenta o inicia sesión.
2. Explora establecimientos y elige uno; ve sus canchas, fotos, tarifas y reglas.
3. Selecciona cancha, fecha y franja horaria disponible.
4. Backend confirma disponibilidad y crea una solicitud sin solapamiento.
5. Si el establecimiento exige adelanto, muestra instrucciones concretas; cliente envía comprobante.
6. Administrador del establecimiento revisa el comprobante y verifica el pago real; aprueba o rechaza según la política.
7. Cliente ve el estado actualizado; sistema notifica según funcionalidades disponibles.
8. Administrador marca inicio real; en el piloto la sesión finaliza automáticamente 60 minutos después, según la decisión explícita del usuario.
9. Operación queda registrada para control e informes.

Diseñar tratamiento para vencimiento, duplicados, reintentos, errores de red, rechazo y cancelación. No prometer confirmación automática por captura.

## 8. Entidades recomendadas para el modelo de datos

Propuesta inicial a validar contra el código existente:

- `users` / `profiles`: cuenta, identidad pública y estado.
- `platform_roles` y `establishment_memberships`: rol global y asignaciones tenant (un usuario podría administrar más de un establecimiento).
- `establishments`: negocio, localización, estado de aprobación/publicación, configuración.
- `courts`: canchas asociadas a establecimiento, configuración y visibilidad.
- `court_images` / `establishment_images`.
- `opening_hours`, `court_availability_rules`, `court_blocks`, `pricing_rules`.
- `reservations`: cliente, cancha, tenant, inicio/fin, precio, estado, fechas, metadatos.
- `reservation_events`: bitácora de cambios y acciones.
- `payments` y `payment_proofs`: montos, estado de verificación, método, referencia, reembolsos según modelado.
- `products`, `inventory_movements`, `sales`, `sale_items`.
- `expenses`, `cash_movements`, `cash_closings`.
- `subscription_plans`, `subscriptions` (fase posterior).
- `notifications`, `audit_logs`.

Usar IDs inmutables, claves foráneas, índices por tenant/fecha/cancha y restricciones de integridad. Para impedir solapamientos, considerar transacciones y restricciones de base de datos cuando el motor lo permita. No almacenar secretos ni datos de tarjetas bancarias.

## 9. Requisitos técnicos y seguridad

1. Antes de elegir stack, inspeccionar el repositorio. El usuario ha estudiado **Angular, Firebase y Supabase**, pero esto NO confirma el stack de GrassGo. Elegir sobre evidencia del proyecto y explicar alternativas.
2. Separar frontend, lógica de negocio, autorización y persistencia. Evitar reglas críticas solo en cliente.
3. Validación de entradas en servidor; manejo de errores y feedback claro.
4. Políticas de seguridad para uploads, sesiones y rutas privadas; rate limiting si aplica.
5. Autorización tenant-level probada con tests negativos: administrador A no puede leer/modificar datos de B.
6. Backups, logs, monitoreo y despliegue reproducible acordes al presupuesto.
7. Accesibilidad básica, responsividad, formatos locales y mensajes sencillos.
8. Variables de entorno para credenciales; nunca hardcodear llaves privadas.
9. Pruebas: creación/reserva simultánea, conflictos de horarios, vencimientos, permisos, stock, conciliación de pagos e informes.
10. Migraciones y datos semilla de demostración (Grass El Puma) claramente separados de producción.

## 10. Interfaz y experiencia de usuario

- Diseño visual moderno, deportivo, claro, rápido y responsive. Fotos grandes para mostrar establecimientos y canchas; **no usar un plano interactivo de la cancha** como requisito.
- **Cliente:** home, listado de locales, detalle, calendario grande, slots de una hora o configurables, login/registro, revisión de reserva, envío de comprobante, mis reservas, historial y notificaciones.
- **Administrador:** login, dashboard del local, calendario de reservas, verificación de pagos, canchas, productos, inventario, ventas, gastos, cierre diario y reportes.
- **Superadmin:** dashboard global, revisión de locales, usuarios y administradores, planes/suscripciones, incidencias y auditoría.
- Diferenciar estados con texto además de color. No mostrar disponibilidad especulativa como confirmada.

## 11. Roadmap propuesto

**Fase 0 — Auditoría:** inspeccionar repositorio y diseños; ejecutar el proyecto; inventariar implementado/faltante; definir stack real y arquitectura.  
**Fase 1 — Fundación multi-tenant:** autenticación, roles, membresías, establecimientos, canchas, reglas de seguridad y pruebas de aislamiento.  
**Fase 2 — Marketplace + reservas:** búsqueda/listado, detalle, disponibilidad, solicitud de reserva, protección frente a cruces de horario.  
**Fase 3 — Pagos manuales + operaciones:** comprobante, revisión del admin, estados, notificaciones in-app, cancelaciones e inicio real de partidos.  
**Fase 4 — Quiosco y administración:** productos, inventario, ventas, gastos, caja diaria, reportes.  
**Fase 5 — Plataforma:** panel superadmin completo, altas y aprobación de negocios, auditoría y soporte. Algunas funciones de superadmin mínimas se necesitan desde Fase 1 para aprobar tenants.  
**Fase 6 — Monetización y despliegue avanzado:** planes/suscripciones, políticas de límites, pagos automatizados solo si se autorizan, observabilidad, mejoras de escalado.

Cada fase debe incluir pruebas, instrucciones para ejecutar, migraciones necesarias y criterios de aceptación. Prioriza un piloto real con Grass El Puma antes de comercializar.

## 12. Reglas de no invención

- No afirmar que los 17 cuestionarios son encuestas a clientes: se trata de **una guía de entrevista de 17 preguntas dirigida al responsable de Grass El Puma**.
- No inventar respuestas, problemas confirmados, métricas, ventas ni fotos.
- No dar por construido backend, base de datos, superadmin ni integraciones solo porque figuran en este documento.
- No cambiar automáticamente el informe académico anterior: se enfocaba en Grass El Puma; el nuevo alcance es visión de producto y requiere actualizar documentación/diagramas si el usuario decide presentarlo así.
- No fijar universalmente S/ 10, 5 horas, precios, descuentos o planes para todos los negocios: ofrecer configuración.
- No inventar pasarelas de pago, verificación automática de Yape o integración con WhatsApp.
- No reemplazar componentes ya existentes sin revisar.

## 13. Pendientes por validar con el usuario

- Framework exacto y hosting de GrassGo según repositorio real.
- Si los establecimientos se registran solos o únicamente por invitación/aprobación del superadmin.
- Modelo de monetización: suscripción, comisión o ambos; importes y límites.
- Tarifas variables, feriados, promociones, duración de slots y política de buffers.
- Tiempo máximo de retención de una reserva pendiente y reglas ante comprobantes inválidos.
- Condiciones de cancelación, reembolso y penalizaciones.
- Canales reales de notificación y necesidad de comprobantes electrónicos/fiscales.
- Opciones de trabajadores/recepcionistas del establecimiento; permisos granulares.
- Cuáles datos recolectar, tiempos de conservación y políticas de privacidad.

## 14. Primer encargo concreto para Codex

1. Lee `AGENTS.md` y este documento entero.
2. Examina el proyecto local y dime: estructura, tecnologías, módulos existentes, errores detectados y cómo arrancarlo.
3. Presenta arquitectura recomendada para multiestablecimiento y roles cliente/admin/superadmin, basada en lo que realmente haya en el repositorio.
4. Presenta un plan de implementación con pequeñas tareas ordenadas y archivos a crear/modificar.
5. Comienza **solo por la Fase 0 y el primer paso de Fase 1** después de confirmar decisiones indispensables; no desarrolles todo de golpe.
6. En cada avance, indica qué hiciste, qué pruebas pasaron y cómo verificarlo desde Windows.

**Meta:** hacer de GrassGo una plataforma escalable y seria, sin perder la simplicidad del piloto y sin sacrificar seguridad ni claridad.
