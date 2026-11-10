# Cambios y decisiones importantes

## 2026-11-10 — Responsables de estadía y mejoras visuales

- El calendario muestra iniciales de la etapa actual. La reserva y la hoja muestran por separado a quien creó la reserva, registró la entrada y registró la salida. Se reutiliza la auditoría para las salidas y los nombres históricos, con la identidad del superadministrador protegida según el rol.
- Las hojas destacan el saldo y distinguen el registro del consumo y sus abonos. La ventana del dólar separa cotización, vigencia y fecha de consulta.
- La versión 1.6.0 incluye los cambios de esta fecha. Antes de actualizar desde 1.5.0, respaldar la carpeta de datos. Las salidas previas a la auditoría pueden quedar sin responsable.
- Pasaron `npm test`, `npm run check` y `npm run build`. El ZIP arrancó con una base ficticia de 1.5.0 y conservó sus reservas y hojas. En Chrome se comprobaron las tres etapas con usuarios distintos, el saldo tras un abono parcial y la consulta al BCB.

## 2026-11-10 — Conversión de tarifas con el dólar oficial del BCB

- Al activar la conversión de USD a Bs se reutiliza la consulta de **Dólar BCB**. Si falla la actualización, el dato oficial guardado se usa mientras esté vigente en hora de Bolivia. Cuando falta un dato vigente, se muestra y aplica el respaldo administrativo si existe.
- Se verificaron la vigencia, el caché, el respaldo y el caso sin cotización en las pruebas de API. Pasaron `npm test`, `npm run check` y `npm run build`. En Chrome se probaron el cálculo con una respuesta del BCB simulada, el guardado de la tarifa de una reserva y el aviso al pasar al respaldo. Se reutiliza el esquema existente.

## 2026-11-10 — Turnos, conversión de tarifas, consumos y auditoría

- Cada sesión abre un turno con Bs 0. La migración 010 relaciona movimientos manuales, cobros de huéspedes y ventas Pub con su turno. Recepción ve sus turnos y administración puede consultar los del equipo. Las anulaciones conservan el movimiento original y su auditoría.
- Administración fija el tipo de cambio de hospedaje. La conversión muestra el resultado y permite cargarlo en la tarifa de la reserva, extensión o talonario, con redondeo al centavo.
- Las hojas se filtran por habitación, nombre o número de reserva y mes de estadía, servicio o abono. El subrayado rojo indica saldo pendiente y se actualiza con los abonos.
- El visor administrativo registra reservas, llegadas, salidas, traslados, cancelaciones, hojas y caja con usuario, hora y valores anteriores y nuevos. Las operaciones nuevas guardan su auditoría dentro de la misma transacción.
- Se comprobaron migraciones, permisos, separación de turnos, cobros agrupados, historial de reservas y cambios de saldo con pruebas HTTP. Pasaron `npm test`, `npm run check` y `npm run build`. En Chrome, con una base temporal, se verificaron el cambio de USD 20 a Bs 140, los filtros, el subrayado antes y después del pago, la vista de auditoría y el inicio de otro usuario con saldo cero.
- Antes de aplicar la migración en recepción, detener la aplicación y respaldar la carpeta de datos completa. Los movimientos anteriores siguen en el cuaderno por fecha y la auditoría antigua conserva los datos disponibles. Queda pendiente el conteo físico para arqueo.

## 2026-11-09 — Consulta del dólar oficial

- **Dólar BCB** consulta el indicador oficial publicado por el Banco Central de Bolivia y muestra la vigencia y la hora de consulta. La migración 009 conserva la última cotización válida para cuando falte internet o la fuente no responda.
- La consulta se hace bajo demanda con un tiempo de espera limitado. Tiene fines informativos y los cobros siguen en bolivianos.
- Pasaron las pruebas de API, la revisión de tipos y la compilación. Se verificó el inicio de sesión, la migración de una copia ficticia de v1.4.0 y la consulta real al BCB desde el paquete de Windows. Queda pendiente la revisión visual en navegador.

## 2026-11-09 — Extender estadías con su propia tarifa

- El calendario permite agregar noches al inicio o al final de una reserva activa. La extensión muestra la tarifa normal sugerida, el cargo adicional y el saldo. Las fechas originales conservan su tarifa y sus pagos.
- La migración 008 guarda la tarifa acordada para las noches adicionales. La hoja de consumo, el cobro de estadía y los indicadores de pago del calendario usan la tarifa de cada noche.
- La extensión comprueba disponibilidad y fechas esperadas dentro de la transacción. Una edición del mismo número de noches conserva el orden de las tarifas al mover fechas y valida los abonos existentes.
- Pasaron las pruebas HTTP, la revisión de tipos y la compilación. Se probó el ZIP con una copia ficticia de v1.3.0 y se verificaron el acceso y el historial después de migrar.

## 2026-11-09 — Hojas por mes, alojamiento y encargado

- Las hojas se listan por mes de llegada o de abono en dos grupos, habitaciones privadas y dormitorios. Las reservas pendientes nuevas generan sus hojas cuando se confirman o cuando se registra un adelanto.
- Los adelantos se registran en la reserva pendiente y se guardan junto con sus hojas en una transacción. El saldo esperado evita duplicarlos al repetir una solicitud.
- La migración 007 agrega el nombre opcional del encargado de una cuenta conjunta. Se conservan las hojas individuales y el historial existente.
- Pasaron las pruebas HTTP, la revisión de tipos y la compilación. Se verificó el ZIP con una copia ficticia de v1.2.0, incluido el inicio de sesión y la consulta del historial.

## 2026-11-09 — Cobro de estadía y corrección de abonos

- Recepción puede confirmar una reserva pendiente y registrar llegada con el saldo completo del hospedaje. Si ya hubo adelantos, cobra el saldo restante. La llegada, el cobro y sus aplicaciones se guardan en la misma transacción.
- La migración 006 agrupa las aplicaciones del cobro en un solo comprobante en las hojas y en un solo ingreso en Caja Chica. Las noches siguen mostrando su saldo y la comisión de tarjeta se calcula una vez por cobro.
- El superadministrador puede editar abonos activos por importe, fecha y medio de pago. El registro reemplazado queda anulado en el historial. Al anular un cobro de estadía se revierten todas sus aplicaciones.
- Pasaron las pruebas HTTP, la revisión de tipos y la compilación. El ZIP de Windows migró una base ficticia de v1.1.0 y conservó el acceso y el historial.

## 2026-11-09 — Jerarquía, habitaciones y cajas separadas

- Las cuentas y novedades del superadministrador solo son visibles para ese rol. Las reservas y movimientos compartidos conservan sus efectos y protegen la identidad de quien actuó. Administración puede gestionar recepción y editar su propio perfil.
- Se puede editar el nombre y la capacidad de las habitaciones. Al reducir un dormitorio se retiran camas sin compromisos actuales o futuros y se conservan las asignaciones históricas.
- La migración 005 habilita el retiro de camas y asigna los movimientos manuales anteriores a Caja Chica. Los abonos de huéspedes van a Caja Chica y las ventas de Inventario Pub van a Caja Pub. El neto mensual descuenta los egresos de cada caja.
- El ZIP actualiza la aplicación usando la base de la cuenta de Windows. El README explica cómo respaldar y actualizar en la PC de recepción.
- Pasaron las pruebas HTTP, la revisión de tipos y la compilación. El ZIP se probó con una base ficticia de v1.0.1 y conservó el acceso y los movimientos al migrar.

## 2026-11-09 — Inicio del paquete de Windows

- El ZIP usa separadores estándar para facilitar la extracción. El iniciador busca los archivos respecto de su propia ubicación y explica cómo extraer el paquete si faltan.

## 2026-11-09 — Paquete portátil para Windows

- Se añadió un ZIP para Windows x64 con Node.js, SQLite integrado, dependencias de producción y la interfaz compilada. `Iniciar-Atatau.cmd` abre la aplicación local y guarda los datos en la carpeta de la cuenta de Windows.
- El script de empaquetado verifica la suma SHA-256 de Node.js. El paquete parte sin datos personales ni credenciales. Se documentaron el traslado de una base existente, el respaldo y los límites de almacenamiento.
- Pasaron `npm test`, `npm run check` y la compilación del paquete. Se hizo una prueba de capacidad con 1.000 reservas ficticias en memoria.

## 2026-11-09 — Navegación y comisión de tarjeta

- La barra superior queda visible al desplazarse. El menú agrupa módulos por área y distingue el módulo activo con un indicador e iconos. Se mejoró el contraste de tablas y el diseño de encabezados y totales con la paleta existente.
- Los cobros nuevos con tarjeta suman 5 % al importe que paga el huésped. Caja registra el importe base en abonos, ventas POP e ingresos manuales. Los nuevos cobros QR usan el importe base y los recargos históricos se conservan como referencia.
- Pasaron `npm test`, `npm run check` y `npm run build`. Se verificaron el importe al huésped, el importe en caja y el tratamiento de recargos históricos. El permiso guardado del navegador bloqueó la revisión visual de la instancia temporal.

## 2026-11-09 — Novedades, recepción de huéspedes y desayunos

- Se amplió la conversación de Novedades y se muestra ayer y hoy según la hora de Bolivia. Los mensajes quedan guardados y los pendientes anteriores se atienden desde el panel lateral.
- La migración 004 registra el primer usuario y la hora de llegada en la reserva y deja el dato vacío para llegadas históricas. Se verificó un respaldo local antes de incorporar la migración.
- El plan de desayuno se elige en la reserva. El reporte diario lista a cada persona y habitación. Cuenta desde la mañana posterior a la entrada hasta la salida incluida, separa pendientes y omite canceladas.
- Pasaron `npm test`, `npm run check` y `npm run build`. Las pruebas cubren el cálculo por noche, el registro de llegada y la conservación del dato al editar. La revisión visual queda pendiente porque el navegador rechazó el acceso a la instancia temporal.

## 2026-11-07 — Error al cargar el sistema después de iniciar sesión

- La sesión se creaba, pero la carga inicial fallaba al consultar Novedades. Una variante instalada de la migración 002 carecía de la columna para enlazar respuestas.
- La migración 003 agrega la columna solo cuando hace falta. Conserva los mensajes y las respuestas existentes. Se creó y verificó un respaldo local antes de aplicarla.
- Se probó la actualización desde ambas variantes de la versión 002 y el inicio de sesión con las cinco consultas de carga inicial en una copia temporal. La base instalada quedó en versión 003 y pasó la revisión de integridad. Pasaron `npm test`, `npm run check` y `npm run build`.

## 2026-11-07 — Arranque con puertos ocupados

- Se reprodujo el fallo al arrancar una segunda instancia con los puertos 3001 y 5173 ya en uso. `npm run dev` comprueba ambos puertos antes de lanzar procesos. `npm start` reserva el puerto antes de abrir SQLite. Los dos comandos indican la dirección ocupada y cómo reiniciar.
- Verificación: ambos arranques duplicados terminaron sin crear la base temporal. La instancia activa siguió entregando la interfaz y respondiendo a `/api/health` en ambos puertos. Pasaron `npm test`, `npm run check` y `npm run build`.

## 2026-11-07 — Chat de turnos, caja y operación de recepción

- Novedades se presenta como chat grupal con nombre, color, hora, respuestas y separadores por fecha. El panel de pendientes cruza fechas y los mensajes resueltos quedan en el historial. Administración edita nombre, usuario y color de las recepcionistas.
- El buscador superior muestra resultados de reservas y hojas mientras se escribe. El calendario abre en una vista ampliada de 7 días y permite cambiar a 14. Cada ocupación tiene un icono de persona y las reservas pendientes apartan disponibilidad con un contorno transparente. Llegada, salida y cancelación tienen acciones separadas.
- Caja diaria permite que recepción vea y registre ingresos del día. El cuaderno mensual y los egresos requieren administración. Caja incorpora abonos y ventas POP, y conserva los movimientos manuales anulados. El POP registra catálogo, altas y bajas de stock y ventas con control de existencias.
- El recargo QR es del 5 % por cobro, redondeado a centavos y guardado por separado. Así se conserva el saldo base y caja muestra el total cobrado. Los QR anteriores mantienen su importe histórico.
- El talonario es editable por habitación, PAX y desayuno. Queda vacío hasta que el hostel disponga de precios verificados. La migración 002 conserva datos y referencias. Respaldar `backend/data/` con la aplicación detenida antes de actualizar.
- Verificación: `npm test`, `npm run check` y `npm run build` aprobados. Se probó una actualización desde una base v1 ficticia y se revisaron en navegador el chat, buscador, calendario, edición de perfiles y tarifas, caja por rol y venta QR del POP. Se usó una base temporal.
- Pendientes: carga del talonario cuando se confirmen los importes y definición de arqueo por turno y reembolsos.

## 2026-11-06 — Disponibilidad y búsqueda de huéspedes

- El calendario muestra camas libres sobre el total por habitación y fecha. La fecha de salida queda libre y las cancelaciones no descuentan camas.
- El buscador general abre reservas y hojas de consumo. Los listados también buscan por titular o acompañante sin exigir tildes.
- Verificado con un dormitorio de siete camas, una reserva de dos personas y búsquedas por el apellido de la acompañante.

## 2026-11-06 — Tarifas, fechas y hoja de consumo

- Selector de entrada y salida con React DayPicker en español. El formulario muestra las noches y el total antes de guardar.
- Migración 001 con tarifas sugeridas por habitación y canal, importe acordado por noche para todo el grupo y hora de llegada. Las reservas previas conservan una tarifa sin definir.
- Hoja de consumo con hospedaje por noche, servicios, pagos parciales, medios de pago, autor, saldo y anulación administrativa con historial. En cuentas individuales el reparto conserva todos los centavos.
- El calendario marca una noche naranja al cubrir su importe total y amarilla si conserva saldo. Una noche sin tarifa o sin cargo se muestra en gris.
- Validación: `npm test`, `npm run check` y `npm run build` aprobados. En navegador con datos ficticios se comprobó la selección de fechas, el total, la hoja y el cambio de color después de un abono.
- Pendientes: reglas de descuentos, reembolsos y caja por turno. Las tarifas se registran en bolivianos según el importe acordado.

## 2026-10-29 — Base inicial

- Se eligió React + TypeScript + Vite y Node.js + Express + SQLite, con frontend y backend en carpetas separadas y módulos por dominio.
- Se creó calendario por habitación/cama, selección de rangos, movimiento de reservas simples y formularios de alta/edición.
- Se centralizó la regla de disponibilidad en una transacción: checkout exclusivo, privada completa y una cama por persona en dormitorio.
- Se agregaron usuarios con tres roles, configuración inicial sin contraseñas predefinidas, sesiones locales y restricciones de administración en backend.
- Se incorporaron canales manuales configurables y entrada directa. No hay conexión automática a Booking/Hostelworld.
- Se crearon huéspedes y hojas automáticamente con cada reserva. La cuenta compartida depende de una elección explícita; PAX solo indica personas.
- Se dejó el contenido financiero de las hojas pendiente del formato real del hostel. PAX y tipo de hoja quedan fijos tras el alta para evitar inconsistencias durante esta etapa.
- Se agregó bitácora de turno con referencias a habitaciones/reservas, gastos informativos en centavos y resolución de pendientes.
- Se documentaron reglas, permisos, respaldo manual con la aplicación detenida, desarrollo y operación en un solo proceso.
- El instalador/paquete portátil de un botón, respaldo automático, caja, bloqueo por mantenimiento y grupos en varias habitaciones quedan pendientes.

### Verificación

- Pruebas de API aprobadas con SQLite en memoria; cubren disponibilidad, cuentas, atomicidad, permisos y sesiones.
- TypeScript y compilación Vite aprobados. Dependencias instaladas y lockfile generado; la instalación informó cero vulnerabilidades conocidas.
- Revisión en navegador con base temporal: configuración inicial, alta de privada y dormitorio de seis camas, reserva conjunta e individual, cambio de fechas, creación de novedad vinculada y consulta de hojas.
- Se comprobó selección de tres noches arrastrando sobre celdas libres y movimiento de una reserva a otra cama/fecha, conservando sus seis noches.
- Correcciones de QA: etiquetas del menú lateral cuando está contraído y eventos de entrada/lectura de las fechas para reflejar y guardar el rango seleccionado.
- Ninguna prueba pobló la base real del hostel. El arranque y el archivo local requieren que el usuario ejecute los comandos del README.
- Comando `npm run dev` comprobado: frontend en 5173 y API en 3001; tanto la página como `/api/health` a través del proxy respondieron HTTP 200. Servidores temporales detenidos al concluir las pruebas.

### Para el siguiente agente

Primero revisar `AGENTS.md`. Solicitar el modelo real de hoja de consumo antes de implementar cargos o pagos. No borrar datos para adaptar el esquema: incorporar migraciones y respaldo antes de evolucionarlo. Actualizar este archivo y el README al cambiar una regla.
