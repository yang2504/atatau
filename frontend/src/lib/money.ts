const formatter = new Intl.NumberFormat("es-BO", {
  style: "currency",
  currency: "BOB",
});
export const money = (cents: number) => formatter.format(cents / 100);
export const paymentMethods = ["Efectivo", "QR", "Transferencia", "Tarjeta", "Otro"];
export const cardSurcharge = (base: number) => Math.floor((base * 5 + 50) / 100);
export function cents(value: string) {
  if (!/^\d{1,7}([.,]\d{1,2})?$/.test(value))
    throw new Error("Ingresa un importe con hasta dos decimales.");
  const [whole, decimal = ""] = value.split(/[.,]/);
  return Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
}
