import { useState, type FormEvent } from "react";
import { UsdConversion } from "../../components/UsdConversion";
import type { Data, Draft, Reservation } from "../../lib/types";
import { api, today, addDays, daysBetween, statusNames } from "../../lib/api";
import { Modal, ErrorBox, Icon } from "../../components/UI";
import { StayDates } from "./StayDates";
import { ReservationStaff } from "./ReservationStaff";
import { cents, money, paymentMethods } from "../../lib/money";
import { CardCharge } from "../../components/CardCharge";
import { lodgingTotal, normalRoomRate } from "../../lib/lodging";

export function ReservationForm({
  data,
  reservation,
  draft,
  onClose,
  onSaved,
  onOpenFolio,
}: {
  data: Data;
  reservation?: Reservation;
  draft?: Draft;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onOpenFolio?: (reservation: Reservation) => void;
}) {
  const r = reservation;
  const initialUnit = r?.unit_ids[0] ?? draft?.unit_id;
  const initialRoom =
    data.rooms.find((room) => room.units.some((u) => u.id === initialUnit)) ??
    data.rooms.find((room) => room.active);
  const [roomId, setRoomId] = useState(initialRoom?.id ?? 0);
  const [units, setUnits] = useState<number[]>(
    r?.unit_ids ??
      (initialUnit
        ? [initialUnit]
        : initialRoom?.type === "private"
          ? [initialRoom.units[0].id]
          : []),
  );
  const [start, setStart] = useState(r?.check_in ?? draft?.check_in ?? today());
  const [end, setEnd] = useState(
    r?.check_out ?? draft?.check_out ?? addDays(today(), 1),
  );
  const [pax, setPax] = useState(r?.pax ?? 1);
  const [mode, setMode] = useState(r?.folio_mode ?? "shared");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const room = data.rooms.find((room) => room.id === roomId);
  const [platformId, setPlatformId] = useState(r?.platform_id ?? 1);
  const [breakfast, setBreakfast] = useState(r?.breakfast ?? 0);
  const [collectOnArrival, setCollectOnArrival] = useState(false);
  const [arrivalMethod, setArrivalMethod] = useState("Efectivo");
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceMethod, setAdvanceMethod] = useState("Efectivo");
  const [rateOverride, setRateOverride] = useState<string | null>(
    r?.nightly_cents != null ? (r.nightly_cents / 100).toFixed(2) : null,
  );
  const suggested =
    (platformId !== 1 ? room?.rates.find((rate) => rate.platform_id === platformId) : undefined) ??
    normalRoomRate(room, pax, breakfast);
  const rate =
    rateOverride ??
    (!r && suggested ? (suggested.nightly_cents / 100).toFixed(2) : "");
  const nights = end ? daysBetween(start, end) : 0;
  const canArrive = r?.status === "confirmed" || r?.status === "pending";
  const priced = /^\d{1,7}([.,]\d{1,2})?$/.test(rate);
  const total = lodgingTotal(r, start, end, priced ? cents(rate) : 0);
  const lodgingDue = Math.max(0, total - (r?.lodging_paid_cents ?? 0));
  const collect = collectOnArrival && lodgingDue > 0;
  const advanceBase = /^\d{1,9}([.,]\d{1,2})?$/.test(advanceAmount) ? cents(advanceAmount) : 0;
  const conflicting = new Set(
    data.reservations
      .filter(
        (other) =>
          other.id !== r?.id &&
          other.status !== "cancelled" &&
          other.check_in < end &&
          other.check_out > start,
      )
      .flatMap((other) => other.unit_ids),
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const operation = submitter instanceof HTMLButtonElement ? submitter.value : "";
    if (operation === "cancelled" && !window.confirm("¿Cancelar esta reserva y liberar sus fechas?")) return;
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const status = form.get("status");
    try {
      await api(
        `/reservations${r ? `/${r.id}` : ""}`,
        {
          guest_name: form.get("guest_name"),
          guest_names: Array.from({ length: pax }, (_, i) =>
            form.get(`guest_${i}`),
          ),
          pax,
          check_in: start,
          check_out: end,
          platform_id: platformId,
          nightly_cents:
            r?.nightly_cents === null && !rate ? undefined : cents(rate),
          arrival_time: form.get("arrival_time"),
          status: operation === "advance" ? "pending" : operation ||
            (status === "confirmed" && r && ["in_house", "checked_out", "cancelled"].includes(r.status) ? r.status : status),
          breakfast,
          folio_mode: mode,
          folio_holder: mode === "shared" ? form.get("folio_holder") : undefined,
          unit_ids: units,
          comments: form.get("comments"),
          check_in_payment: operation === "in_house" && collect
            ? { method: arrivalMethod, amount_cents: lodgingDue }
            : undefined,
          advance_payment: operation === "advance"
            ? { method: advanceMethod, amount_cents: advanceBase, expected_balance_cents: lodgingDue }
            : undefined,
        },
        r ? "PUT" : "POST",
      );
      await onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={r ? `Reserva #${r.id}` : "Nueva reserva"} onClose={onClose}>
      <form onSubmit={submit} className="form-stack">
        <ErrorBox message={error} />
        <label>
          Huésped / responsable
          <input
            autoFocus
            name="guest_name"
            placeholder="Nombre y apellido"
            defaultValue={r?.guest_name}
            required
            maxLength={100}
          />
        </label>
        <StayDates
          start={start}
          end={end}
          onChange={(from, to) => {
            setStart(from);
            setEnd(to);
          }}
        />
        {canArrive || r?.status === "in_house" ? <p className="muted small">
          Para agregar noches con otra tarifa, usa Alargar estadía en el calendario.
        </p> : null}
        <div className="form-grid">
          <label>
            Habitación
            <select
              value={roomId}
              onChange={(e) => {
                const id = Number(e.target.value);
                setRoomId(id);
                const next = data.rooms.find((r) => r.id === id)!;
                setUnits(next.type === "private" ? [next.units[0].id] : []);
              }}
              required
            >
              <option value={0} disabled>
                Seleccionar habitación
              </option>
              {data.rooms
                .filter((r) => r.active)
                .map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name} ·{" "}
                    {room.type === "private" ? "Privada" : "Dormitorio"} (
                    {room.capacity})
                  </option>
                ))}
            </select>
          </label>
          <label>
            PAX · personas
            <input
              type="number"
              min={1}
              max={room?.capacity ?? 30}
              value={pax}
              disabled={!!r}
              onChange={(e) => setPax(Number(e.target.value))}
              required
            />
          </label>
        </div>
        {room?.type === "dorm" && (
          <fieldset>
            <legend>
              Una cama por persona · {units.length} seleccionada(s)
            </legend>
            <div className="bed-options">
              {room.units.filter((unit) => unit.active || units.includes(unit.id)).map((unit) => (
                <label
                  key={unit.id}
                  className={`bed-option ${conflicting.has(unit.id) ? "unavailable" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={units.includes(unit.id)}
                    onChange={(e) =>
                      setUnits(
                        e.target.checked
                          ? [...units, unit.id]
                          : units.filter((id) => id !== unit.id),
                      )
                    }
                  />
                  {unit.label}
                  {!unit.active && " · retirada"}
                  {conflicting.has(unit.id) && " · ocupada"}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {room?.type === "private" &&
          units.some((id) => conflicting.has(id)) && (
            <p className="error">
              Esta habitación ya tiene una reserva en esas fechas.
            </p>
          )}
        {!r && pax > 1 && (
          <details>
            <summary>Agregar nombres de acompañantes (opcional)</summary>
            <div className="form-stack">
              {Array.from({ length: Math.max(0, pax - 1) }, (_, i) => (
                <label key={i}>
                  Acompañante {i + 2}
                  <input name={`guest_${i + 1}`} maxLength={100} />
                </label>
              ))}
            </div>
          </details>
        )}
        <div className="form-grid">
          <label>
            Canal de reserva
            <select
              name="platform_id"
              value={platformId}
              onChange={(e) => setPlatformId(Number(e.target.value))}
            >
              {data.platforms
                .filter((p) => p.active || p.id === r?.platform_id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {!p.active ? " (inhabilitada)" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Estado
            <select name="status" defaultValue={r?.status === "pending" ? "pending" : "confirmed"} disabled={r?.status === "cancelled"}>
              {["confirmed", "pending"].map((key) => (
                <option key={key} value={key}>
                  {statusNames[key]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Plan de desayuno
          <select value={breakfast} onChange={(e) => setBreakfast(Number(e.target.value))}>
            <option value={0}>Sin desayuno</option>
            <option value={1}>Con desayuno · todas las noches</option>
          </select>
        </label>
        {breakfast === 1 && nights > 0 && <p className="form-note">
          {pax * nights} desayunos en total · {pax} por mañana, del {addDays(start, 1)} al {end}.
        </p>}
        {r && <>
          <ReservationStaff reservation={r} />
          {onOpenFolio && <div className="row-actions">
            <button type="button" className="button secondary compact" disabled={busy}
              onClick={() => onOpenFolio(r)}><Icon name="receipt" size={15} /> Ver hojas de consumo</button>
          </div>}
        </>}
        <div className="form-grid">
          <label>
            Tarifa {r && Object.keys(r.night_rates).length > 0 ? "original " : ""}por noche para {pax} {pax === 1 ? "persona" : "personas"}{" "}
            (Bs)
            <input
              inputMode="decimal"
              pattern="[0-9]{1,7}([.,][0-9]{1,2})?"
              value={rate}
              onChange={(e) => setRateOverride(e.target.value)}
              required={r?.nightly_cents !== null}
              placeholder="Ej. 150.00"
            />
          </label>
          <label>
            Hora de llegada (opcional)
            <input
              name="arrival_time"
              type="time"
              defaultValue={r?.arrival_time}
            />
          </label>
        </div>
        <UsdConversion onApply={setRateOverride} />
        {(priced || total > 0) && nights > 0 && (
          <p className="form-note">
            Hospedaje total · {nights} {nights === 1 ? "noche" : "noches"} ·{" "}
            {money(total)}
          </p>
        )}
        {!r && suggested && rateOverride !== null && (
          <button
            type="button"
            className="text-button"
            onClick={() => setRateOverride(null)}
          >
            Usar tarifa sugerida · {money(suggested.nightly_cents)}
          </button>
        )}
        <label>
          Hoja de consumo
          <select
            value={mode}
            disabled={!!r}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="shared">Una cuenta a nombre del encargado</option>
            <option value="individual">Una cuenta por persona</option>
          </select>
        </label>
        {mode === "shared" && <label>
          Encargado de la cuenta
          <input name="folio_holder" maxLength={100} defaultValue={r?.folio_holder} placeholder="Si queda vacío, se usa el titular de la reserva" />
        </label>}
        {r && (
          <p className="muted small">
            PAX y tipo de cuenta quedan fijos para conservar las hojas creadas.
            Para cambiar esos datos, cancela esta reserva y crea una nueva.
          </p>
        )}
        <label>
          Observaciones
          <textarea
            name="comments"
            defaultValue={r?.comments}
            placeholder="Hora de llegada, pedidos especiales…"
            maxLength={2000}
          />
        </label>
        {canArrive && lodgingDue > 0 && (
          <fieldset className="form-stack">
            <legend>Cobro al llegar</legend>
            <label className="bed-option">
              <input type="checkbox" checked={collectOnArrival} onChange={(e) => setCollectOnArrival(e.target.checked)} />
              Registrar el pago completo del hospedaje · {money(lodgingDue)}
            </label>
            {collect && <>
              <label>Medio de pago al llegar
                <select value={arrivalMethod} onChange={(e) => setArrivalMethod(e.target.value)}>
                  {paymentMethods.map((method) => <option key={method}>{method}</option>)}
                </select>
              </label>
              {arrivalMethod === "Tarjeta" && <CardCharge base={lodgingDue} />}
            </>}
          </fieldset>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cerrar
          </button>
          <button disabled={busy || !room || !end || r?.status === "cancelled"} className="button primary">
            {busy ? "Guardando…" : r ? "Guardar cambios" : "Crear reserva"}
          </button>
          {canArrive && <button className="button secondary" value="in_house" disabled={busy}>
            {r?.status === "pending" ? "Confirmar y registrar llegada" : "Registrar llegada"}
            {collect && " con pago"}
          </button>}
        </div>
        {r?.status === "pending" && lodgingDue > 0 && (
          <details className="form-stack">
            <summary>Registrar un adelanto sin confirmar la reserva</summary>
            <div className="form-grid">
              <label>Importe del adelanto (Bs)
                <input inputMode="decimal" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} />
              </label>
              <label>Medio de pago del adelanto
                <select value={advanceMethod} onChange={(e) => setAdvanceMethod(e.target.value)}>
                  {paymentMethods.map((method) => <option key={method}>{method}</option>)}
                </select>
              </label>
            </div>
            {advanceMethod === "Tarjeta" && <CardCharge base={advanceBase} />}
            <button className="button secondary" value="advance" disabled={busy || !advanceBase || advanceBase > lodgingDue}>
              Registrar adelanto
            </button>
          </details>
        )}
        {r && (
          <details>
            <summary>Acciones de la estadía</summary>
            {["in_house", "checked_out", "cancelled"].includes(r.status) && <p>{statusNames[r.status]}</p>}
            <div className="modal-actions">
              {r.status === "in_house" && <button className="button secondary" value="checked_out" disabled={busy}>Registrar salida</button>}
              {r.status === "cancelled"
                ? <button className="button secondary" value="confirmed" disabled={busy}>Reactivar reserva</button>
                : <button className="button secondary" value="cancelled" disabled={busy}>Cancelar reserva</button>}
            </div>
          </details>
        )}
      </form>
    </Modal>
  );
}
