import { localDateTime } from "../../lib/api";
import type { Reservation } from "../../lib/types";

export function reservationStaff(reservation: Reservation) {
  return [
    { label: "Reserva", code: "R", name: reservation.created_by_name },
    { label: "Entrada", code: "E", name: reservation.checked_in_by_name },
    { label: "Salida", code: "S", name: reservation.checked_out_by_name },
  ];
}

export function ReservationStaff({ reservation }: { reservation: Reservation }) {
  return <dl className="reservation-staff" aria-label="Responsables de la estadía">
    {reservationStaff(reservation).map(({ label, code, name }) => <div key={code}>
      <dt>{label}</dt>
      <dd>{name ?? "Sin registro"}</dd>
      {code === "E" && reservation.checked_in_at && <dd className="cell-sub">
        {localDateTime(reservation.checked_in_at)}
      </dd>}
    </div>)}
  </dl>;
}
