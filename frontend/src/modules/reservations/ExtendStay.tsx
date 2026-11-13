import { useState, type FormEvent } from "react";
import { ErrorBox, Modal } from "../../components/UI";
import { UsdConversion } from "../../components/UsdConversion";
import { addDays, api, daysBetween, shortDate } from "../../lib/api";
import { lodgingTotal, normalRoomRate } from "../../lib/lodging";
import { cents, money } from "../../lib/money";
import type { Reservation, Room } from "../../lib/types";

export function ExtendStay({ reservation, rooms, onClose, onSaved, onMove }: {
  reservation: Reservation;
  rooms: Room[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onMove?: () => void;
}) {
  const r = reservation;
  const group = r.room_assignments.length > 0;
  const rates = rooms.map((room) => normalRoomRate(room,
    r.room_assignments.find((place) => place.room_id === room.id)?.pax ?? r.pax, r.breakfast));
  const suggested = rates.length && rates.every(Boolean)
    ? rates.reduce((sum, rate) => sum + (rate?.nightly_cents ?? 0), 0) : null;
  const [start, setStart] = useState(r.check_in);
  const [end, setEnd] = useState(addDays(r.check_out, 1));
  const [rate, setRate] = useState(suggested !== null ? (suggested / 100).toFixed(2) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const added = daysBetween(start, r.check_in) + daysBetween(r.check_out, end);
  const valid = start <= r.check_in && end >= r.check_out && added > 0;
  const priced = /^\d{1,7}([.,]\d{1,2})?$/.test(rate);
  const extra = priced && valid ? added * cents(rate) : 0;
  const original = lodgingTotal(r, r.check_in, r.check_out, r.nightly_cents ?? 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/reservations/${r.id}/extend`, {
        check_in: start, check_out: end,
        expected_check_in: r.check_in, expected_check_out: r.check_out,
        extension_nightly_cents: cents(rate),
      });
      await onSaved();
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Alargar estadía" onClose={() => { if (!busy) onClose(); }}>
      <form className="form-stack" onSubmit={submit}>
        <p><strong>{r.guest_name}</strong> · {rooms.map((room) => room.name).join(", ")} · Reserva #{r.id}</p>
        <p className="muted">Estadía actual del {shortDate(r.check_in)} al {shortDate(r.check_out)}. Las noches actuales conservan su tarifa.</p>
        <ErrorBox message={error} />
        {onMove && <div className="row-actions"><button type="button" className="button secondary" onClick={onMove} disabled={busy}>
          Alargar en otra habitación
        </button></div>}
        <div className="form-grid">
          <label>Nueva llegada<input type="date" value={start} max={r.check_in} disabled={!!r.moves.length}
            onChange={(e) => setStart(e.target.value)} required /></label>
          <label>Nueva salida<input type="date" value={end} min={r.check_out} onChange={(e) => setEnd(e.target.value)} required /></label>
        </div>
        <label>{group ? "Tarifa total del grupo por noche adicional" : `Tarifa normal por noche adicional para ${r.pax} PAX`} (Bs)
          <input inputMode="decimal" pattern="[0-9]{1,7}([.,][0-9]{1,2})?"
            value={rate} onChange={(e) => setRate(e.target.value)} required />
        </label>
        <UsdConversion onApply={setRate} />
        {suggested === null && <p className="muted">Ingresa la tarifa acordada para las noches adicionales.</p>}
        {valid && priced && <div className="form-note">
          <p>{r.nightly_cents === null ? "Importes registrados hasta ahora" : "Estadía actual"} · {money(original)}</p>
          <p>Noches adicionales · {added} · {money(extra)}</p>
          <p><strong>Nuevo total de hospedaje · {money(original + extra)}</strong></p>
          <p>Saldo de hospedaje · {money(Math.max(0, original + extra - r.lodging_paid_cents))}</p>
        </div>}
        <div className="modal-actions">
          <button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cerrar</button>
          <button className="button primary" disabled={busy || !valid || !priced}>Guardar extensión</button>
        </div>
      </form>
    </Modal>
  );
}
