import { useState, type FormEvent } from "react";
import { UsdConversion } from "../../components/UsdConversion";
import type { Data, Draft, Reservation, RoomAssignment } from "../../lib/types";
import { api, today, addDays, daysBetween, shortDate, statusNames } from "../../lib/api";
import { Modal, ErrorBox, Icon } from "../../components/UI";
import { StayDates } from "./StayDates";
import { ReservationStaff } from "./ReservationStaff";
import { cents, money, paymentMethods } from "../../lib/money";
import { CardCharge } from "../../components/CardCharge";
import { lodgingTotal, normalRoomRate, occupiedUnits } from "../../lib/lodging";
import { GroupRooms } from "./GroupRooms";
import { AddGuest } from "./AddGuest";
import { DocumentScanner } from "./DocumentScanner";

export function ReservationForm({
  data,
  reservation,
  draft,
  onClose,
  onSaved,
  onOpenFolio,
  onMove,
}: {
  data: Data;
  reservation?: Reservation;
  draft?: Draft;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onOpenFolio?: (reservation: Reservation) => void;
  onMove?: (reservation: Reservation) => void;
}) {
  const r = reservation;
  const [addingGuest, setAddingGuest] = useState(false);
  const [group, setGroup] = useState(!!r?.room_assignments.length);
  const [assignments, setAssignments] = useState<RoomAssignment[]>(r?.room_assignments ?? []);
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
  const [saved, setSaved] = useState(false);
  const [groupRateOverride, setGroupRateOverride] = useState<string | null>(
    group && r?.nightly_cents != null ? (r.nightly_cents / 100).toFixed(2) : null,
  );
  const [rateOverride, setRateOverride] = useState<string | null>(
    r?.nightly_cents != null ? (r.nightly_cents / 100).toFixed(2) : null,
  );
  const suggested =
    (platformId !== 1 ? room?.rates.find((rate) => rate.platform_id === platformId) : undefined) ??
    normalRoomRate(room, pax, breakfast);
  const groupPax = assignments.reduce((sum, item) => sum + item.pax, 0);
  const groupRates = assignments.map((item) => {
    const room = data.rooms.find((room) => room.id === item.room_id);
    return (platformId !== 1 ? room?.rates.find((rate) => rate.platform_id === platformId) : undefined) ??
      normalRoomRate(room, item.pax, breakfast);
  });
  const groupSuggested = groupRates.length && groupRates.every(Boolean)
    ? groupRates.reduce((sum, rate) => sum + (rate?.nightly_cents ?? 0), 0) : null;
  const rate = group
    ? groupRateOverride ?? (groupSuggested !== null ? (groupSuggested / 100).toFixed(2) : "")
    : rateOverride ?? (!r && suggested ? (suggested.nightly_cents / 100).toFixed(2) : "");
  const nights = end ? daysBetween(start, end) : 0;
  const canArrive = r?.status === "confirmed" || r?.status === "pending";
  const priced = /^\d{1,7}([.,]\d{1,2})?$/.test(rate) && (!group || cents(rate) <= 100_000_000);
  const total = lodgingTotal(r, start, end, priced ? cents(rate) : 0);
  const lodgingDue = Math.max(0, total - (r?.lodging_paid_cents ?? 0));
  const collect = collectOnArrival && lodgingDue > 0;
  const advanceBase = /^\d{1,9}([.,]\d{1,2})?$/.test(advanceAmount) ? cents(advanceAmount) : 0;
  const historical = r?.status === "cancelled" || (r?.status === "checked_out" && r.check_out <= today());
  const groupGuestLabels = [...assignments].sort((a, b) => a.room_id - b.room_id).flatMap((item) =>
    Array.from({ length: Number.isInteger(item.pax) ? Math.min(30, Math.max(0, item.pax)) : 0 },
      () => data.rooms.find((room) => room.id === item.room_id)?.name));
  const conflicting = new Set(
    data.reservations
      .filter(
        (other) =>
          other.id !== r?.id,
      )
      .flatMap((other) => occupiedUnits(other, start, end)),
  );
  const groupReady = assignments.length >= 2 && (!r || groupPax === r.pax) && assignments.every((item) => {
    const room = data.rooms.find((room) => room.id === item.room_id);
    return historical || (room?.active && Number.isInteger(item.pax) && item.pax >= 1 && item.pax <= room.capacity &&
      (room.type === "private" ? item.unit_ids.length === 1 : item.unit_ids.length === item.pax) &&
      item.unit_ids.every((id) => !conflicting.has(id) && room.units.some((unit) => unit.id === id && unit.active)));
  });
  const groupAdvanceInvalid = group && !r && advanceAmount.trim() !== "" &&
    (advanceBase === 0 || advanceBase > lodgingDue);

  function chooseGroup() {
    if (!assignments.length && draft?.unit_id && initialRoom && !conflicting.has(draft.unit_id))
      setAssignments([{ room_id: initialRoom.id, unit_ids: [draft.unit_id], pax: 1 }]);
    setGroup(true);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (saved) {
      setBusy(true);
      try {
        await onSaved();
        onClose();
      } catch {
        setError("La reserva ya se guardó. Intenta actualizar la vista nuevamente.");
      } finally {
        setBusy(false);
      }
      return;
    }
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const operation = submitter instanceof HTMLButtonElement ? submitter.value : "";
    if (operation === "cancelled" && !window.confirm(group
      ? "¿Cancelar la reserva de grupo y liberar todas sus habitaciones?"
      : "¿Cancelar esta reserva y liberar sus fechas?")) return;
    if (group && (!end || nights < 1 || !priced || groupAdvanceInvalid || (!groupReady && operation !== "cancelled"))) {
      setError("Revisa las habitaciones, las plazas, la tarifa y el importe del adelanto.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const status = form.get("status");
    try {
      await api(
        `/reservations${r ? `/${r.id}` : ""}`,
        {
          guest_name: form.get("guest_name"),
          guest_names: Array.from({ length: group ? groupGuestLabels.length : pax }, (_, i) =>
            form.get(`guest_${i}`),
          ),
          pax: group ? groupPax : pax,
          check_in: start,
          check_out: end,
          platform_id: platformId,
          nightly_cents:
            r?.nightly_cents === null && !rate ? undefined : cents(rate),
          arrival_time: form.get("arrival_time"),
          status: operation === "advance" ? "pending" : operation ||
            (status === "confirmed" && r && ["in_house", "checked_out", "cancelled"].includes(r.status) ? r.status : status),
          breakfast,
          folio_mode: group ? "shared" : mode,
          folio_holder: !group && mode === "shared" ? form.get("folio_holder") : undefined,
          unit_ids: group ? undefined : units,
          room_assignments: group ? assignments : undefined,
          comments: form.get("comments"),
          check_in_payment: operation === "in_house" && collect
            ? { method: arrivalMethod, amount_cents: lodgingDue }
            : undefined,
          advance_payment: operation === "advance" || (group && !r && advanceBase > 0)
            ? { method: advanceMethod, amount_cents: advanceBase, expected_balance_cents: lodgingDue }
            : undefined,
        },
        r ? "PUT" : "POST",
      );
      setSaved(true);
      try {
        await onSaved();
        onClose();
      } catch {
        setError("La reserva ya se guardó. Actualiza la vista para ver los cambios.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={addingGuest ? "Ampliar huéspedes" : r ? `Reserva${group ? " de grupo" : ""} #${r.id}` : "Nueva reserva"}
      className={group ? "group-reservation-dialog" : undefined} onClose={onClose}>
      {addingGuest && r ? <AddGuest reservation={r} data={data} onSaved={async () => {
        await onSaved();
        onClose();
      }} onClose={() => setAddingGuest(false)} /> : <form onSubmit={submit} className="form-stack">
        <ErrorBox message={error} />
        {saved ? <div className="modal-actions">
          <button className="button primary" disabled={busy}>Actualizar vista</button>
        </div> : <>
        {!r && <div className="tabs reservation-kind" role="group" aria-label="Tipo de reserva">
          <button type="button" aria-pressed={!group} className={!group ? "active" : ""} onClick={() => setGroup(false)}>Un cuarto</button>
          <button type="button" aria-pressed={group} className={group ? "active" : ""} onClick={chooseGroup}>Reserva de grupo</button>
        </div>}
        <label>
          {group ? "Encargado de la reserva y de la cuenta" : "Huésped / responsable"}
          <input
            autoFocus
            name="guest_name"
            placeholder="Nombre y apellido"
            defaultValue={r?.guest_name}
            required
            maxLength={100}
          />
        </label>
        {group && <p className="group-common-dates">Estas fechas se aplican a todos los cuartos del grupo.</p>}
        <DocumentScanner />
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
        {group ? <>
          <GroupRooms rooms={data.rooms} assignments={assignments} occupied={conflicting}
            datesReady={nights > 0} historical={historical} onChange={setAssignments} />
          {r && groupPax !== r.pax && <p className="error">Distribuye las {r.pax} personas de la reserva entre los cuartos.</p>}
          {groupGuestLabels.length > 0 && <details>
            <summary>Agregar nombres de huéspedes (opcional)</summary>
            <div className="form-grid">
              {groupGuestLabels.map((name, index) => <label key={index}>
                Huésped {index + 1} · {name}
                <input name={`guest_${index}`} maxLength={100}
                  defaultValue={r?.guests[index]?.name === `Huésped ${index + 1}` ? "" : r?.guests[index]?.name} />
              </label>)}
            </div>
          </details>}
        </> : <>
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
              disabled={!!r?.moves.length || !!onMove && r?.status === "in_house"}
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
                    disabled={!!r?.moves.length || !!onMove && r?.status === "in_house"}
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
        </>}
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
          {(group ? groupPax : pax) * nights} desayunos en total · {group ? groupPax : pax} por mañana, del {addDays(start, 1)} al {end}.
        </p>}
        {r && <>
          <ReservationStaff reservation={r} />
          {onMove && <div className="row-actions"><button type="button" className="button secondary compact" disabled={busy}
            onClick={() => onMove(r)}>{r.check_out === today() ? "Alargar en otra habitación" : "Cambiar de habitación"}</button></div>}
          {!!r.moves.length && <div className="group-booking-summary">
            <h3>Traslados registrados</h3>
            {[...new Set(r.moves.map((move) => move.day))].map((day) => <p key={day}>{shortDate(day)} · {data.rooms
              .find((room) => room.units.some((unit) => unit.id === r.moves.find((move) => move.day === day)?.unit_id))?.name}</p>)}
          </div>}
          {!r.moves.length && (canArrive || r.status === "in_house") && r.check_out > today() &&
            <div className="row-actions">
              <button type="button" className="button secondary compact" disabled={busy}
                onClick={() => setAddingGuest(true)}><Icon name="users" size={16} /> Ampliar huéspedes</button>
            </div>}
          {!!r.added_guests.length && <div className="group-booking-summary">
            <h3>Huéspedes incorporados</h3>
            <ul>{r.added_guests.map((guest) => {
              const room = data.rooms.find((item) => item.units.some((unit) => unit.id === guest.unit_id));
              const bed = room?.type === "dorm" ? room.units.find((unit) => unit.id === guest.unit_id)?.label : null;
              return <li key={guest.id}>{guest.name} · desde {shortDate(guest.joined_on)} · {room?.name}{bed && ` · ${bed}`}</li>;
            })}</ul>
          </div>}
          {onOpenFolio && <div className="row-actions">
            <button type="button" className="button secondary compact" disabled={busy}
              onClick={() => onOpenFolio(r)}><Icon name="receipt" size={15} /> {group ? "Abrir hoja del grupo" : "Ver hojas de consumo"}</button>
          </div>}
        </>}
        <div className="form-grid">
          <label>
            {group ? "Tarifa total del grupo por noche" :
              `Tarifa ${r && Object.keys(r.night_rates).length > 0 ? "original " : ""}por noche para ${pax} ${pax === 1 ? "persona" : "personas"}`}{" "}
            (Bs)
            <input
              inputMode="decimal"
              pattern="[0-9]{1,7}([.,][0-9]{1,2})?"
              value={rate}
              onChange={(e) => (group ? setGroupRateOverride : setRateOverride)(e.target.value)}
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
        {group && rate && !priced && <p className="error">Ingresa una tarifa válida de hasta Bs 1.000.000 por noche.</p>}
        <UsdConversion onApply={group ? setGroupRateOverride : setRateOverride} />
        {!group && (priced || total > 0) && nights > 0 && (
          <p className="form-note">
            Hospedaje total · {nights} {nights === 1 ? "noche" : "noches"} ·{" "}
            {money(total)}
          </p>
        )}
        {!group && !r && suggested && rateOverride !== null && (
          <button
            type="button"
            className="text-button"
            onClick={() => setRateOverride(null)}
          >
            Usar tarifa sugerida · {money(suggested.nightly_cents)}
          </button>
        )}
        {group && !r && groupSuggested !== null && groupRateOverride !== null &&
          <button type="button" className="text-button" onClick={() => setGroupRateOverride(null)}>
            Usar tarifas sugeridas · {money(groupSuggested)} por noche
          </button>}
        {!group && <><label>
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
            El PAX original y el tipo de cuenta se conservan. Usa Ampliar huéspedes para registrar una incorporación.
          </p>
        )}
        </>}
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
        {group && !r && <fieldset className="form-stack group-advance">
          <legend>Adelanto de reserva (opcional)</legend>
          <div className="form-grid">
            <label>Importe del adelanto (Bs)
              <input inputMode="decimal" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} />
            </label>
            <label>Medio de pago del adelanto
              <select value={advanceMethod} disabled={!advanceBase} onChange={(e) => setAdvanceMethod(e.target.value)}>
                {paymentMethods.map((method) => <option key={method}>{method}</option>)}
              </select>
            </label>
          </div>
          {groupAdvanceInvalid && <p className="error">Ingresa un importe válido que no supere el saldo de hospedaje.</p>}
          {advanceMethod === "Tarjeta" && advanceBase > 0 && <CardCharge base={advanceBase} />}
        </fieldset>}
        {group && <section className="group-booking-summary" aria-label="Resumen de la reserva">
          <div>
            <h3>Una hoja de consumo</h3>
            <p aria-live="polite">{assignments.length} {assignments.length === 1 ? "cuarto" : "cuartos"} · {groupPax} {groupPax === 1 ? "persona" : "personas"} · {nights || "—"} {nights === 1 ? "noche" : "noches"}</p>
          </div>
          {priced && nights > 0 && <dl>
            <div><dt>Hospedaje total</dt><dd>{money(total)}</dd></div>
            {!!(r?.lodging_paid_cents || (!r && advanceBase)) && <div>
              <dt>{r ? "Abonado" : `Adelanto · ${advanceMethod}`}</dt><dd>{money(r?.lodging_paid_cents ?? advanceBase)}</dd>
            </div>}
            <div><dt>Saldo de hospedaje</dt><dd>{money(Math.max(0, lodgingDue - (r ? 0 : advanceBase)))}</dd></div>
          </dl>}
        </section>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cerrar
          </button>
          <button disabled={busy || (group ? !groupReady || !priced || groupAdvanceInvalid : !room) || !end || r?.status === "cancelled"} className="button primary">
            {busy ? "Guardando…" : r ? "Guardar cambios" : group ? "Crear reserva de grupo" : "Crear reserva"}
          </button>
          {canArrive && <button className="button secondary" value="in_house" disabled={busy || (group && !groupReady)}>
            {r?.status === "pending" ? "Confirmar y registrar llegada" : "Registrar llegada"}
            {collect && " con pago"}
          </button>}
        </div>
        {!group && r?.status === "pending" && lodgingDue > 0 && (
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
        </>}
      </form>}
    </Modal>
  );
}
