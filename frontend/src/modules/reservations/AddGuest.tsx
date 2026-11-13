import { useState, type FormEvent } from "react";
import { ErrorBox } from "../../components/UI";
import { api, addDays, daysBetween, shortDate, today } from "../../lib/api";
import { occupiedUnits } from "../../lib/lodging";
import { cents, money } from "../../lib/money";
import type { Data, Reservation } from "../../lib/types";

export function AddGuest({ reservation: r, data, onSaved, onClose }: {
  reservation: Reservation;
  data: Data;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [day, setDay] = useState(r.check_in > today() ? r.check_in : today());
  const [unit, setUnit] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const blocked = new Set(data.reservations.filter((other) => other.id !== r.id)
    .flatMap((other) => occupiedUnits(other, day, r.check_out)));
  const rooms = data.rooms.filter((room) => room.active && room.units.some((item) => r.unit_ids.includes(item.id)));
  const choices = rooms.map((room) => ({
    room,
    units: room.units.filter((item) => item.active && !blocked.has(item.id) && (room.type === "private"
      ? (r.room_assignments.find((place) => place.room_id === room.id)?.pax ?? r.pax) +
        r.added_guests.filter((guest) => guest.unit_id === item.id).length < item.capacity
      : !r.unit_ids.includes(item.id) && !r.added_guests.some((guest) => guest.unit_id === item.id))),
  }));
  const available = choices.flatMap(({ units }) => units);
  const selected = available.find((item) => String(item.id) === unit) ?? (available.length === 1 ? available[0] : undefined);
  const validDay = day >= r.check_in && day < r.check_out;
  const nights = validDay ? daysBetween(day, r.check_out) : 0;
  const amount = /^\d{1,7}([.,]\d{1,2})?$/.test(rate) ? cents(rate) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (!saved) {
        if (!selected || !validDay || amount === null) return;
        await api(`/reservations/${r.id}/guests`, {
          name: fields.get("name"), joined_on: day, unit_id: selected.id, nightly_cents: amount,
          expected_added: r.added_guests.length,
          expected_check_out: r.check_out,
        });
        setSaved(true);
      }
      await onSaved();
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <form className="form-stack" onSubmit={submit}>
    <p><strong>{r.guest_name}</strong> · Reserva #{r.id} · Salida {shortDate(r.check_out)}</p>
    <ErrorBox message={error} />
    {!saved && <>
      <label>Nombre del huésped<input name="name" autoFocus maxLength={100} required /></label>
      <label>Fecha de incorporación<input type="date" value={day} min={r.check_in}
        max={addDays(r.check_out, -1)} required onChange={(event) => setDay(event.target.value)} /></label>
      <label>Habitación o cama
        <select required value={selected?.id ?? ""} onChange={(event) => setUnit(event.target.value)}>
          <option value="">{available.length ? "Selecciona una plaza" : "Sin plazas disponibles"}</option>
          {choices.filter(({ units }) => units.length).map(({ room, units }) => <optgroup key={room.id} label={room.name}>
            {units.map((item) => <option key={item.id} value={item.id}>
              {room.type === "private" ? room.name : `${room.name} · ${item.label}`}
            </option>)}
          </optgroup>)}
        </select>
      </label>
      <label>Tarifa adicional por noche (Bs)
        <input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)}
          placeholder="Escribe 0 si no hay recargo" required />
      </label>
      <p className="muted">El huésped se registra desde esta fecha. Los cargos anteriores se conservan.</p>
      {validDay && !available.length && <p className="error">No hay plazas libres hasta la salida en los cuartos de esta reserva.</p>}
      {nights > 0 && amount !== null && <div className="group-booking-summary" aria-live="polite">
        <strong>{nights} {nights === 1 ? "noche" : "noches"} · Total adicional {money(nights * amount)}</strong>
        <p>{r.folio_mode === "shared" ? "Se suma a la hoja de consumo de la reserva." : "Se registra en una hoja individual para este huésped."}</p>
      </div>}
    </>}
    <div className="modal-actions">
      <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Volver</button>
      <button className="button primary" disabled={busy || (!saved && (!validDay || !selected || amount === null || amount > 100_000_000))}>
        {saved ? "Actualizar vista" : busy ? "Guardando…" : "Agregar huésped"}
      </button>
    </div>
  </form>;
}
