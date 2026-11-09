# Hostel Atatau

Sistema web local para recepción. **Primera base funcional**, con React + TypeScript + Vite en `frontend/` y Node.js + Express + SQLite en `backend/`. Los datos se guardan en un archivo local; no se usa ningún servicio externo para operar.

## Usar en Windows sin instalar herramientas

Descarga el ZIP de Windows x64 desde [Releases](https://github.com/yang2504/atatau/releases/latest). Extrae toda la carpeta y abre **Iniciar-Atatau.cmd**. Se abrirá [Hostel Atatau](http://127.0.0.1:3001) en el navegador. Deja la ventana de la aplicación abierta mientras trabajas. Para detenerla, pulsa `Ctrl+C` en esa ventana.

Si aparece un mensaje de archivo faltante, haz clic derecho en el ZIP y elige **Extraer todo**. Abre el archivo de inicio desde la carpeta extraída, al lado de `runtime`, `backend` y `frontend`.

El paquete es para Windows 10/11 de 64 bits e incluye Node.js, SQLite, el servidor y la interfaz compilada. Usa el navegador instalado en la computadora. Una vez descargado y extraído, funciona sin internet, npm ni permisos de administrador.

Los datos del paquete se guardan en `%LOCALAPPDATA%\HostelAtatau\data` para la cuenta de Windows que lo ejecuta. Puedes abrir esa ubicación con `Win+R`.

Para actualizar en la PC de recepción, cierra Atatau con `Ctrl+C` y copia la carpeta de datos como respaldo. Descarga el ZIP de la nueva versión, extráelo en una carpeta nueva y abre su `Iniciar-Atatau.cmd` desde la misma cuenta de Windows. El sistema abrirá la base existente y aplicará las migraciones. Verifica tu sesión y tus reservas antes de retirar el acceso directo anterior.

Si vas a trasladar una base de desarrollo, detén las dos instancias y copia el contenido de `backend/data/` a `%LOCALAPPDATA%\HostelAtatau\data` antes del primer arranque del paquete. Respalda la carpeta de destino si ya contiene datos.

## Desarrollo desde el código fuente

- Node.js **22.14 o superior de la rama 22** (o una versión posterior compatible). Esta base usa `node:sqlite`; Node 22.14 lo incluye con aviso experimental. No hace falta instalar SQLite, PostgreSQL, Docker ni compiladores nativos.
- Internet solo para descargar las dependencias durante la preparación del proyecto. La aplicación compilada funciona sin internet.

Desde la carpeta raíz:

```powershell
npm install
npm run dev
```

Abrir **http://127.0.0.1:5173**. Crear el primer superadministrador en la pantalla inicial, después agregar habitaciones en **Habitaciones**. No existen contraseñas predefinidas ni huéspedes de ejemplo en la base real.

Para operar con un solo proceso después de compilar:

```powershell
npm run build
npm start
```

Abrir **http://127.0.0.1:3001**. En este modo Node sirve tanto el frontend compilado como la API. Detener con `Ctrl+C`.

Si el arranque indica `EADDRINUSE`, el puerto ya está ocupado. Prueba abrir la dirección indicada. Si ya está abierta una instancia del sistema y necesitas reiniciarla, pulsa `Ctrl+C` en su terminal antes de volver a ejecutar el comando.

Para generar el paquete de Windows desde el código, instala las dependencias con `npm ci` y ejecuta `powershell -ExecutionPolicy Bypass -File scripts/package-windows.ps1` desde la raíz. El script descarga la versión fijada de Node.js, verifica su suma SHA-256 y empaqueta solo los componentes de ejecución.

## Qué funciona

- Calendario de 7 o 14 días con encabezado fijo, iconos de personas y filas por cama. Permite seleccionar rangos, navegar por fechas, crear y editar reservas. Arrastrar una reserva de una cama o privada conserva el número de noches. Las reservas de varias camas se reubican desde su formulario.
- Privadas completas y dormitorios con camas individuales. Administración puede editar el nombre y la capacidad desde **Habitaciones**, además de habilitar e inhabilitar.
- El calendario indica las camas libres sobre el total de cada dormitorio para cada fecha. En privadas muestra si la habitación está libre u ocupada.
- La barra superior permanece visible al desplazarse. **Buscar huésped** muestra resultados en vivo y abre reservas u hojas de consumo. Incluye acompañantes y búsquedas sin tildes. El menú lateral agrupa las pantallas por área.
- Reservas con responsable, PAX, acompañantes opcionales, canal, fechas, notas y estado. Detección de cruces en backend dentro de una transacción.
- El botón **+** de una reserva activa en el calendario abre **Alargar estadía**. Puedes agregar noches antes de la llegada o después de la salida. Las noches originales conservan su tarifa y sus abonos. Las adicionales usan la tarifa normal indicada al guardar. La sugerencia viene del talonario por PAX y desayuno o de la tarifa directa de la habitación.
- Booking, Hostelworld y entrada directa disponibles. Agregar/inhabilitar plataformas conserva el historial. Son etiquetas de origen: **no hay sincronización con plataformas externas**.
- Tres roles con permisos verificados en API. Sesiones de 12 horas; contraseñas con scrypt y salt. Desactivar un usuario impide nuevas peticiones con su sesión.
- Selector visual de entrada y salida en el formulario, con resumen de noches y total del hospedaje antes de guardar.
- Talonario editable en **Configuración → Tarifas sugeridas → Talonario**, por habitación, PAX y desayuno. Para reservas nuevas se sugiere la tarifa específica del canal, luego la del talonario y finalmente la base de la habitación, según disponibilidad. Recepción puede escribir el importe acordado por noche para todo el grupo. El talonario empieza vacío para cargar importes verificados.
- Hojas de consumo conjuntas o individuales con hospedaje por noche, cargos de servicios, abonos parciales, saldo y registro del medio de pago y del usuario. Los importes individuales reparten la tarifa del grupo de forma que la suma sea exacta.
- Las reservas pendientes se muestran con borde discontinuo y fondo transparente. En las confirmadas, el naranja indica noches pagadas, el amarillo indica saldo y el gris indica noches sin tarifa o sin cargo.
- **Novedades** funciona como chat grupal con nombres, colores y respuestas. La conversación visible abarca ayer y hoy en hora de Bolivia. Los mensajes anteriores siguen guardados y los pendientes de otras fechas se pueden consultar y resolver desde el panel lateral.
- Al pulsar **Registrar llegada**, la reserva guarda el usuario que recibió a los huéspedes y la fecha y hora del registro. Las llegadas anteriores a esta función quedan sin ese dato.
- En **Reservas** se elige el plan con o sin desayuno para toda la estadía. **Desayunos** muestra por fecha las personas, su habitación y su reserva. Cuenta un desayuno por persona la mañana siguiente a cada noche, incluida la salida. Separa los pendientes de confirmación y omite las cancelaciones.
- Al registrar una llegada, puedes cobrar el saldo completo del hospedaje con un solo pago. En una reserva pendiente, **Confirmar y registrar llegada** permite hacerlo en el mismo paso. La hoja muestra un comprobante de estadía y Caja Chica recibe un solo movimiento. Las hojas individuales muestran cuánto les corresponde del mismo pago.
- **Hojas de consumo** separa habitaciones privadas y dormitorios. Una hoja aparece en el mes de llegada cuando se confirma la reserva. Si se registra un adelanto en una reserva pendiente, sus hojas quedan disponibles en el mes de llegada y en el del abono. Los abonos posteriores también permiten encontrar la hoja en su mes.
- En una reserva puedes elegir una hoja por huésped o una cuenta conjunta a nombre de la persona encargada. Si dejas el encargado vacío, se usa el titular de la reserva.
- **Caja Chica** recibe los abonos de huéspedes y **Caja Pub** recibe las ventas del inventario. Elige una caja antes de anotar un movimiento manual. Administración tiene ingresos, egresos, neto e historial mensual separados por caja. Los movimientos manuales previos quedaron en Caja Chica.
- **Inventario Pub** registra productos, entradas, bajas y ventas. Cada venta descuenta unidades y registra el ingreso en Caja Pub dentro de la misma transacción.
- Registro técnico de cambios en `audit_log`, todavía sin visor en la interfaz.

## Reglas de operación

**PAX** significa personas. Una reserva de 3 PAX es una reserva para tres personas; no define por sí misma cómo pagan. La modalidad de cuenta se elige por separado.

La estadía usa `[entrada, salida)`: entrada el 1 y salida el 5 equivale a cuatro noches. Otra reserva puede entrar el 5. Una privada con una persona ocupa la habitación completa aunque su capacidad sea dos. En un dormitorio se selecciona exactamente una cama por persona. Cada reserva ocupa una sola habitación en esta versión.

Desde **Hojas de consumo**, abre una hoja, elige **Abonar** en la fila de la noche o servicio y registra importe, fecha y medio de pago. **A/C** suma los abonos activos del cargo. Administración puede anular un abono incorrecto desde su historial. Las noches con abonos vigentes deben conservarse en el rango y mantienen la tarifa acordada.

Al cobrar con **tarjeta**, ingresa el importe base. El total a cobrar incluye el 5 % de comisión, redondeada al centavo por operación. Caja y el saldo del huésped registran el importe base. Esta regla también aplica a las ventas del Pub y los ingresos manuales. Los cobros nuevos por QR se registran por el importe base. Los recargos históricos quedan visibles como referencia y separados del total de caja.

En **Hojas de consumo**, el superadministrador puede editar el importe, la fecha y el medio de pago de un abono activo. Al editar, la versión anterior queda anulada y la corrección actualiza los saldos y Caja Chica. Administración y el superadministrador pueden anular abonos. Si se anula un cobro de estadía, se revierten todas sus aplicaciones a la vez.

En el formulario de reserva elige **Confirmada** o **Pendiente**. Ambas apartan disponibilidad. Las operaciones de llegada, salida y cancelación están en **Acciones de la estadía**.

El calendario muestra las fechas reservadas incluso después de registrar la salida, para conservar el historial. Si alguien sale antes, ajustar la fecha de salida al registrar ese cambio. Las reservas canceladas liberan disponibilidad, conservando sus huéspedes y hojas. Los contadores muestran PAX **asignados por fecha**, incluyendo reservas confirmadas; no sustituyen el estado de check-in.

PAX y modalidad de cuenta quedan fijos tras crear una reserva para conservar las hojas. Para corregirlos, cancela la reserva y crea otra. Al reducir la capacidad de un dormitorio solo se retiran camas sin reservas actuales o futuras y se conservan sus asignaciones históricas. Una privada puede reducirse hasta la capacidad que requieran sus reservas actuales y futuras. El tipo de habitación queda fijo. Para inhabilitar una habitación, cierra, cancela o reubica primero sus reservas activas.

Las personas acompañantes sin nombre se guardan como `Acompañante 2`, etc. Falta acordar con el hostel los datos personales obligatorios y su edición posterior.

## Roles

| Acción | Recepcionista | Administradora | Superadministrador |
| --- | --- | --- | --- |
| Calendario, reservas, hojas y novedades | Sí | Sí | Sí |
| Habitaciones y plataformas | Consulta | Gestiona | Gestiona |
| Crear/activar/desactivar recepcionistas | No | Sí | Sí |
| Editar nombre, usuario y color de recepcionistas | No | Sí | Sí |
| Crear/activar/desactivar administradores y superadministradores | No | No | Sí |
| Ver ingresos del día y registrar ingresos manuales del día | Sí | Sí | Sí |
| Ver cuaderno mensual, registrar egresos y anular movimientos manuales | No | Sí | Sí |
| Consultar Inventario Pub y registrar ventas | Sí | Sí | Sí |
| Editar Inventario Pub y registrar entradas o bajas de stock | No | Sí | Sí |

Solo el rol superadministrador ve las cuentas y novedades de ese nivel. Los demás roles ven los movimientos compartidos necesarios para operar, con la identidad del superadministrador protegida. Administración puede editar su propio perfil y gestionar las cuentas de recepción.

Nadie puede desactivar su propio usuario. La gestión de roles existentes, recuperación/cambio de contraseñas y el visor de auditoría quedan pendientes de una próxima etapa.

## Datos y respaldo

La base es `atatau.sqlite` dentro de `%LOCALAPPDATA%\HostelAtatau\data` en el paquete de Windows o `backend/data/` en desarrollo. También pueden existir archivos `-wal` y `-shm`. **Detén la aplicación antes de copiar toda la carpeta de datos** a una ubicación de respaldo. Para restaurar, detén la aplicación y recupera la carpeta completa. Mantén el respaldo fuera de Git.

SQLite conserva los registros sin una fecha de vencimiento. Con las páginas de 4096 bytes de este sistema, su límite teórico ronda los 17,5 TB. En recepción importa el espacio libre del disco y el volumen que se carga en cada pantalla. Una prueba local con 1.000 reservas ficticias, 3 huéspedes, 2 noches, 2 abonos y una novedad por reserva añadió aproximadamente 0,66 MB a SQLite. El tamaño real depende de la cantidad y el contenido de los registros. [Límites oficiales de SQLite](https://sqlite.org/limits.html)

Antes de arrancar esta versión sobre una base existente, haz ese respaldo. La migración 008 permite guardar tarifas para las noches adicionales y conserva las tarifas y los abonos existentes.

La aplicación escucha exclusivamente en `127.0.0.1`: solo se accede desde el equipo del hostel. Los usuarios pueden turnarse en ese equipo; no está configurada para acceso por red ni multi-PC. Se usa la zona horaria `America/La_Paz` y fechas ISO sin hora para las estadías. La moneda de los gastos de novedades se asume bolivianos; confirmar al definir consumos.

## Validación

```powershell
npm test
npm run check
npm run build
```

Las pruebas usan SQLite en memoria y HTTP real: cruces, límites de fechas/capacidad, atomicidad, cuentas compartidas e individuales, roles, bloqueo de usuarios, plataformas históricas, novedades y control de origen. No tocan los datos reales.

## Siguientes decisiones

1. Definir reglas de descuentos, reembolsos y arqueo por turno.
2. Confirmar habitaciones reales, camas, moneda y datos requeridos por huésped.
3. Definir si un grupo necesita varias habitaciones con una sola cuenta; el modelo actual reserva una habitación por reserva.
4. Añadir bloqueo de camas por mantenimiento, copias automáticas y recuperación de contraseña.

Consultar `AGENTS.md` antes de continuar y registrar cambios importantes en `docs/CAMBIOS.md`. Las decisiones de arquitectura están en `docs/ARQUITECTURA.md`.

Referencias del stack: [React con Vite](https://react.dev/learn/build-a-react-app-from-scratch), [requisitos de Vite](https://vite.dev/guide/), [SQLite integrado en Node.js 22](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html).
