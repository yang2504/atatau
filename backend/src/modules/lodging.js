export const MAX_NIGHTLY_CENTS = 100_000_000;

export function lodgingShare(nightlyCents, pax, position) {
  return position === null
    ? nightlyCents
    : Math.floor(nightlyCents / pax) + Number(position < nightlyCents % pax);
}

export function nightRates(db, reservationId) {
  const rows = db.prepare("SELECT day,nightly_cents FROM reservation_night_rates WHERE reservation_id=?")
    .all(reservationId);
  return Object.fromEntries(rows.map((row) => [row.day, row.nightly_cents]));
}

export function* nightDates(start, end) {
  for (let time = Date.parse(start); time < Date.parse(end); time += 86400000)
    yield new Date(time).toISOString().slice(0, 10);
}

export function paidNights(db, reservationId, nightlyCents, overrides) {
  return db
    .prepare(
      `SELECT p.lodging_day AS day, SUM(p.retained_cents) AS total FROM folio_payment_balances p
     JOIN folios f ON f.id=p.folio_id
     WHERE f.reservation_id=? AND p.lodging_day IS NOT NULL AND p.voided=0
     GROUP BY p.lodging_day`,
    )
    .all(reservationId)
    .filter((row) => row.total === (overrides[row.day] ?? nightlyCents))
    .map((row) => row.day);
}
