import { addDays, daysBetween } from "./api";
import type { Reservation, Room } from "./types";

export function occupiedUnits(reservation: Reservation, start: string, end: string) {
  if (!start || !end || end <= start || reservation.status === "cancelled") return [];
  return [...new Set(reservation.occupancy.filter((span) => span.starts_on < end && span.ends_on > start)
    .map((span) => span.unit_id))];
}

export function normalRoomRate(room: Room | undefined, pax: number, breakfast: number) {
  return room?.guest_rates.find((rate) => rate.pax === pax && rate.breakfast === breakfast)
    ?? room?.rates.find((rate) => rate.platform_id === 1);
}

export function lodgingTotal(reservation: Reservation | undefined, start: string, end: string, base: number) {
  if (!start || !end) return 0;
  const nights = Math.max(0, daysBetween(start, end));
  const shift = reservation && nights === daysBetween(reservation.check_in, reservation.check_out)
    ? daysBetween(reservation.check_in, start) : 0;
  let total = nights * base;
  for (const [day, rate] of Object.entries(reservation?.night_rates ?? {})) {
    const current = shift ? addDays(day, shift) : day;
    if (current >= start && current < end) total += rate - base;
  }
  for (const guest of reservation?.added_guests ?? [])
    total += Math.max(0, daysBetween(guest.joined_on > start ? guest.joined_on : start, end)) * guest.nightly_cents;
  return total;
}
