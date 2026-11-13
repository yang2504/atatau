import type { Folio, Reservation } from "./types";

export function nameMatches(query: string, ...names: string[]) {
  const normalize = (value: string) =>
    value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const terms = normalize(query).split(/\s+/);
  return names.some((name) => {
    const normalized = normalize(name);
    return terms.every((term) => normalized.includes(term));
  });
}

export function reservationMatches(query: string, reservation: Reservation) {
  return nameMatches(
    query,
    reservation.guest_name,
    ...reservation.guests.map((guest) => guest.name),
    ...reservation.added_guests.map((guest) => guest.name),
  );
}

export function folioMatches(
  query: string,
  folio: Folio,
  reservation?: Reservation,
) {
  return (
    nameMatches(query, folio.title) ||
    (folio.guest_id === null &&
      !!reservation &&
      reservationMatches(query, reservation))
  );
}
