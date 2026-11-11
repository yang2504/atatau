export const paymentMethods = ["Efectivo", "QR", "Transferencia", "Tarjeta", "Otro"];

export function cardSurcharge(base, method) {
  return method === "Tarjeta" ? Math.floor((base * 5 + 50) / 100) : 0;
}

export function localDay(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/La_Paz" }).format(now);
}
