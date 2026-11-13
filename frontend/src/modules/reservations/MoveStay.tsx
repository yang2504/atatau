import { useState, type FormEvent } from "react";
import { ErrorBox, Modal } from "../../components/UI";
import { addDays, api, daysBetween, shortDate, today } from "../../lib/api";
import { occupiedUnits } from "../../lib/lodging";
import { cents, money } from "../../lib/money";
import type { Data, Reservation } from "../../lib/types";

export function canMoveStay(r: Reservation) {
  return (["pending", "confirmed", "in_house"].includes(r.status) ||
    (r.status === "checked_out" && r.check_out === today())) && r.check_out >= today() &&
    !r.room_assignments.length && !r.added_guests.length;
}

export function MoveStay({ reservation: r, data, extend, onClose, onSaved }: {
  reservation: Reservation;
  data: Data;
  extend: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const last = r.moves.at(-1);
  const current = data.rooms.find((room) => room.units.some((unit) => unit.id === (last?.unit_id ?? r.unit_ids[0])));
  const earliest = [today(), r.check_in, last ? addDays(last.day, 1) : ""].sort().at(-1)!;
  const [day, setDay] = useState(extend ? r.check_out : earliest);
  const [end, setEnd] = useState(extend || earliest === r.check_out ? addDays(r.check_out, 1) : r.check_out);
  const [roomId, setRoomId] = useState("");
  const [beds, setBeds] = useState<number[]>([]);
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const blocked = new Set(data.reservations.filter((other) => other.id !== r.id)
    .flatMap((other) => occupiedUnits(other, day, end)));
  const candidates = data.rooms.filter((room) => room.active && room.id !== current?.id)
    .map((room) => ({ room, units: room.units.filter((unit) => unit.active && !blocked.has(unit.id)) }))
    .filter(({ room, units }) => room.type === "private" ? room.capacity >= r.pax && units.length : units.length >= r.pax);
  const destination = candidates.find(({ room }) => String(room.id) === roomId);
  const ids = destination?.room.type === "private" ? [destination.units[0].id]
    : beds.filter((id) => destination?.units.some((unit) => unit.id === id));
  const extendsStay = end > r.check_out;
  const nights = day && end ? daysBetween(day, end) : 0;
  const nightly = /^\d{1,7}([.,]\d{1,2})?$/.test(rate) ? cents(rate) : null;
  const valid = day >= earliest && day <= r.check_out && end >= r.check_out && end > day &&
    daysBetween(r.check_in, end) <= 366 && (nightly === null ? !rate && !extendsStay : nightly <= 100_000_000) &&
    !!destination && ids.length === (destination.room.type === "private" ? 1 : r.pax);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (!saved && !valid)) return;
    setBusy(true);
    setError("");
    try {
      if (!saved) {
        await api(`/reservations/${r.id}/move`, { day, check_out: end, unit_ids: ids,
          nightly_cents: nightly, expected_check_out: r.check_out,
          expected_last_move: last?.day ?? null });
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

  return <Modal title={extend ? "Alargar y cambiar de habitación" : "Cambiar de habitación"} onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <p><strong>{r.guest_name}</strong> · {current?.name} · {r.pax} PAX</p>
      <ErrorBox message={error} />
      {!saved && <>
        <div className="form-grid">
          <label>Fecha de traslado<input type="date" value={day} min={earliest} max={r.check_out} required
            onChange={(e) => setDay(e.target.value)} /></label>
          <label>Salida<input type="date" value={end} min={r.check_out} required onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <label>Habitación de destino<select value={destination ? roomId : ""} required
          onChange={(e) => { setRoomId(e.target.value); setBeds([]); }}>
          <option value="">{candidates.length ? "Seleccionar habitación" : "Sin cuartos disponibles"}</option>
          {candidates.map(({ room, units }) => <option key={room.id} value={room.id}>{room.name}
            {room.type === "dorm" ? ` · ${units.length} camas libres` : ` · ${room.capacity} plazas`}</option>)}
        </select></label>
        {destination?.room.type === "dorm" && <fieldset>
          <legend>Elige {r.pax} {r.pax === 1 ? "cama" : "camas"}</legend>
          <div className="bed-options">{destination.units.map((unit) => <label key={unit.id} className="bed-option">
            <input type="checkbox" checked={beds.includes(unit.id)}
              onChange={(e) => setBeds(e.target.checked ? [...beds, unit.id] : beds.filter((id) => id !== unit.id))} />
            {unit.label}
          </label>)}</div>
        </fieldset>}
        <label>Tarifa por noche en destino (Bs)
          <input value={rate} inputMode="decimal" pattern="[0-9]{1,7}([.,][0-9]{1,2})?" required={extendsStay}
            placeholder={extendsStay ? "Tarifa acordada" : "En blanco conserva las tarifas"} onChange={(e) => setRate(e.target.value)} />
        </label>
        <p className="form-note">{day && end ? `Destino del ${shortDate(day)} al ${shortDate(end)}. ` : ""}
          Las noches anteriores al traslado y los abonos quedan en la misma hoja.</p>
        {nightly !== null && nights > 0 && <p className="group-booking-summary" aria-live="polite">
          {nights} {nights === 1 ? "noche" : "noches"} en destino · {money(nightly * nights)}
        </p>}
      </>}
      <div className="modal-actions">
        <button className="button secondary" type="button" onClick={onClose}>Cerrar</button>
        <button className="button primary" disabled={busy || (!saved && !valid)}>{saved ? "Actualizar vista" : "Guardar traslado"}</button>
      </div>
    </form>
  </Modal>;
}
