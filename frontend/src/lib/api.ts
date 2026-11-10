export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? { credentials: "same-origin" }
      : {
          method,
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "No se pudo completar la operación.");
  return data;
}
export function today(at = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/La_Paz",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
export function addDays(day: string, count: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(start: string, end: string) {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      86400000,
  );
}
export function shortDate(day: string, includeYear = false) {
  return new Intl.DateTimeFormat("es-BO", {
    day: "numeric",
    month: "short",
    year: includeYear ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}
const operationTime = new Intl.DateTimeFormat("es-BO", {
  dateStyle: "short", timeStyle: "medium", timeZone: "America/La_Paz",
});
export const localDateTime = (at: string) => operationTime.format(new Date(at));
export const statusNames: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  in_house: "En casa",
  checked_out: "Salida registrada",
  cancelled: "Cancelada",
};
export const roleNames: Record<string, string> = {
  superadmin: "Superadministrador",
  admin: "Administradora",
  receptionist: "Recepcionista",
};
