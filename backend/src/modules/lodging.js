export const MAX_NIGHTLY_CENTS = 100_000_000;

export function lodgingShare(nightlyCents, pax, position) {
  return position === null
    ? nightlyCents
    : Math.floor(nightlyCents / pax) + Number(position < nightlyCents % pax);
}

export function paidNights(db, reservationId, nightlyCents) {
  if (nightlyCents === null) return [];
  return db
    .prepare(
      `SELECT p.lodging_day AS day FROM folio_payments p
     JOIN folios f ON f.id=p.folio_id
     WHERE f.reservation_id=? AND p.lodging_day IS NOT NULL AND p.voided=0
     GROUP BY p.lodging_day HAVING SUM(p.amount_cents)=?`,
    )
    .all(reservationId, nightlyCents)
    .map((row) => row.day);
}
