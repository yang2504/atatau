import { addDays, daysBetween } from "./api";
import type { Reservation, Room } from "./types";

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
  return total;
}
