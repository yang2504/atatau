# Guía de trabajo — Hostel Atatau

Leer primero `C:\Users\WILLIAMS\.codex\RTK.md`, `README.md`, `docs/ARQUITECTURA.md` y `docs/CAMBIOS.md`.

## Objetivo y límites

Aplicación web local para una recepción operada por una persona por turno. Priorizar claridad, pocas dependencias y ausencia de servicios externos. Frontend y backend separados, organizados por módulos. No publicar, introducir Docker, bases de datos servidor, servicios de pago ni sincronización con plataformas sin una nueva necesidad acordada.

## Estructura

- `frontend/src/modules/`: funcionalidades visibles por dominio.
- `frontend/src/lib/`: tipos, cliente API y fechas compartidos por vistas.
- `frontend/src/components/`: componentes de interfaz reutilizables.
- `backend/src/modules/`: API y lógica del dominio correspondiente.
- `backend/src/core/`: SQLite, esquema y validaciones comunes.
- `backend/test/`: pruebas de reglas de negocio y API con base en memoria.

Usar React + TypeScript en frontend y JavaScript ESM en backend. Mantener SQL parametrizado y reglas críticas en backend; nunca confiar en controles visuales para permisos o disponibilidad. No introducir capas vacías de servicios/repositorios/interfaces. Extraer lógica cuando haya reutilización real.

## Invariantes

- Fechas ISO `YYYY-MM-DD`, rango `[entrada, salida)`, sin convertir noches a la zona horaria del navegador.
- Privada = una unidad exclusiva; dormitorio = una unidad por cama.
- Una reserva por habitación, exactamente una cama por PAX en dormitorio.
- Cruce si `existente.entrada < nueva.salida && existente.salida > nueva.entrada`. Las reservas canceladas no bloquean; las salidas conservan su historial de fechas.
- Validación, asignaciones, huéspedes, hojas y auditoría deben persistir en una misma transacción SQLite. No separar comprobación de disponibilidad y escritura por `await`.
- No duplicar hojas al editar ni borrar el historial al cancelar, inhabilitar usuarios o plataformas.
- PAX y modalidad de hoja son inmutables en esta base; ampliar esta regla requiere definir conciliación de huéspedes/cargos primero.
- Dinero en centavos enteros. Gastos de novedades separados de cargos al huésped.
- Roles siempre revisados en API. Sin credenciales predefinidas, tokens ni bases personales en Git.
- Escuchar en loopback. No ampliar a LAN sin revisar autenticación, origen, transporte y respaldos.

## Trabajo con varios agentes

Cuando el usuario autorice trabajo paralelo, asignar un responsable por módulo y archivos concretos; evitar ediciones simultáneas del mismo archivo. Los agentes deben reportar archivos modificados, contrato API, pruebas y limitaciones. El agente integrador coordina cambios en `App.tsx`, `types.ts`, esquema, dependencias y documentación. No cambiar un contrato compartido sin comunicarlo antes. No usar varias bases de datos reales para integrar trabajo.

## Validación y entrega

Ejecutar `npm test`, `npm run check` y `npm run build` para cambios de lógica/contratos. Añadir una prueba mínima que reproduzca cada regla nueva o corrección importante; no duplicar pruebas de presentación triviales. Para cambios de UI, revisar visualmente el flujo afectado y conservar accesibilidad, navegación por teclado, labels y errores legibles.

Usar `ATATAU_DB` apuntando a un archivo temporal para pruebas manuales con datos ficticios; no poblar ni borrar la base real. No leer ni exponer contraseñas ni hashes en la interfaz/logs. No crear commits ni publicar cambios sin solicitud.

Registrar en `docs/CAMBIOS.md` la fecha, decisión/corrección, motivo, pruebas realizadas y trabajo pendiente. Mantener `README.md` alineado con el comportamiento entregado. Antes de cambiar datos persistidos, crear migración explícita y documentar respaldo; `CREATE TABLE IF NOT EXISTS` solo crea la base inicial, no migra estructuras existentes.
