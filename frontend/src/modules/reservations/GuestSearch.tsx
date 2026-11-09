import { useState } from "react";
import { Icon } from "../../components/UI";
import { shortDate } from "../../lib/api";
import {
  folioMatches,
  nameMatches,
  reservationMatches,
} from "../../lib/guestSearch";
import type { Data, Folio, Reservation } from "../../lib/types";

export function GuestSearch({
  data,
  onReservation,
  onFolio,
}: {
  data: Data;
  onReservation: (reservation: Reservation) => void;
  onFolio: (folio: Folio) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  function select(work: () => void) {
    setOpen(false);
    setQuery("");
    work();
  }
  const reservations = query.trim()
    ? data.reservations.filter((reservation) =>
        reservationMatches(query, reservation),
      )
    : [];
  const byId = new Map(
    data.reservations.map((reservation) => [reservation.id, reservation]),
  );
  const folios = query.trim()
    ? data.folios.filter((folio) =>
        folioMatches(query, folio, byId.get(folio.reservation_id)),
      )
    : [];
  return (
    <div className="guest-search" role="search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.querySelector("input")?.focus();
          setOpen(false);
        }
      }}>
        <label className="guest-search-field">
          <Icon name="search" />
          <input
            aria-label="Buscar huésped por nombre o apellido"
            type="search"
            placeholder="Buscar huésped…"
            value={query}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
          />
        </label>
      {open && <div className="panel form-stack guest-search-popover">
        <p className="muted" role="status">
          {query.trim()
            ? reservations.length + folios.length
              ? `${reservations.length} reservas · ${folios.length} hojas de consumo`
              : "No se encontraron huéspedes con ese nombre."
            : "Busca al titular o a un acompañante para abrir su reserva o su hoja de consumo."}
        </p>
        {reservations.length > 0 && (
          <section>
            <h3>Reservas</h3>
            <ul className="guest-results">
              {reservations.map((reservation) => (
                <li key={reservation.id}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => select(() => onReservation(reservation))}
                  >
                    {reservation.guest_name} · #{reservation.id} ·{" "}
                    {shortDate(reservation.check_in)} →{" "}
                    {shortDate(reservation.check_out)}
                  </button>
                  {reservation.guests
                    .filter(
                      (guest) =>
                        guest.name !== reservation.guest_name &&
                        nameMatches(query, guest.name),
                    )
                    .map((guest) => (
                      <small key={guest.id} className="cell-sub">
                        Acompañante · {guest.name}
                      </small>
                    ))}
                </li>
              ))}
            </ul>
          </section>
        )}
        {folios.length > 0 && (
          <section>
            <h3>Hojas de consumo</h3>
            <ul className="guest-results">
              {folios.map((folio) => (
                <li key={folio.id}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => select(() => onFolio(folio))}
                  >
                    {folio.title} · Hoja #{folio.id}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>}
    </div>
  );
}
