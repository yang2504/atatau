import { useEffect, useRef, useState, type FormEvent } from "react";
import { ErrorBox, Icon, Modal } from "../../components/UI";
import { addDays, api, daysBetween, shortDate, statusNames, today } from "../../lib/api";
import { cents, money, paymentMethods, lodgingPaymentMethods } from "../../lib/money";
import { CardCharge } from "../../components/CardCharge";
import { ReservationStaff } from "../reservations/ReservationStaff";
import type { Data, Folio, FolioEntry, Payment, StayPayment, User } from "../../lib/types";

type Refund = { id: number; day: string; payment_id: number; amount_cents: number; folio_cents: number; reason: string; method: string; author: string };
type FolioDetails = { entries: FolioEntry[]; stay_payments: StayPayment[]; refunds: Refund[] };

export function FolioSheet({
  folio,
  data,
  user,
  onClose,
  onSaved,
}: {
  folio: Folio;
  data: Data;
  user: User;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [details, setDetails] = useState<FolioDetails | null>(null);
  const entries = details?.entries;
  const [payment, setPayment] = useState<FolioEntry | null>(null);
  const [editing, setEditing] = useState<{ payment: Payment; group: boolean } | null>(null);
  const [refunding, setRefunding] = useState<{ payment: Payment; group: boolean } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("Efectivo");
  const [amountText, setAmountText] = useState("");
  const [refundText, setRefundText] = useState("");
  const [voiding, setVoiding] = useState<number | null>(null);
  const [removing, setRemoving] = useState<FolioEntry | null>(null);
  const [onlyDue, setOnlyDue] = useState(false);
  const [showService, setShowService] = useState(false);
  const [payStay, setPayStay] = useState(false);
  const [payFullStay, setPayFullStay] = useState(false);
  const [showRate, setShowRate] = useState(false);
  const [notice, setNotice] = useState("");
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const path = `/folios/${folio.id}`;
  useEffect(() => {
    api<FolioDetails>(path)
      .then(setDetails)
      .catch((error) => setError(error.message));
  }, [path]);
  const reservation = data.reservations.find(
    (r) => r.id === folio.reservation_id,
  );
  const locations = data.rooms.flatMap((room) => {
    const units = room.units.filter((unit) => folio.extra_unit_id ? unit.id === folio.extra_unit_id
      : reservation?.occupancy.some((span) => span.unit_id === unit.id));
    if (!units.length) return [];
    const pax = reservation?.room_assignments.find((item) => item.room_id === room.id)?.pax;
    const detail = room.type === "dorm" ? units.map((unit) => unit.label).join(", ")
      : pax ? `${pax} PAX` : units[0].label;
    return [`${room.name} · ${detail}`];
  });
  const total = (key: "paid_cents" | "balance_cents" | "total_cents") =>
    (entries ?? []).reduce((sum, row) => sum + row[key], 0);
  async function save(endpoint: string, body: () => unknown, done: () => void, method = "POST", feedback = "Cambios guardados.") {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    let committed = false;
    try {
      await api(path + endpoint, body(), method);
      committed = true;
      done();
      setDetails(await api<FolioDetails>(path));
      setNotice(feedback);
      await onSaved();
    } catch (error) {
      setError(committed ? "El movimiento se guardó. Vuelve a abrir la hoja para actualizarla." : (error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function submitService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void save(
      "/services",
      () => ({
        day: values.get("day"),
        service: values.get("service"),
        detail: values.get("detail"),
        total_cents: cents(String(values.get("total"))),
      }),
      () => { form.reset(); setShowService(false); },
    );
  }
  function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payment && !editing && !payStay) return;
    const values = new FormData(event.currentTarget);
    void save(
      editing ? paymentPath(editing.payment, editing.group) : payStay ? "/stay-payments" : "/payments",
      () => ({
        lodging_day: payment?.lodging_day,
        service_id: payment?.service_id,
        day: values.get("day"),
        method: values.get("method"),
        amount_cents: cents(String(values.get("amount"))),
        expected_balance_cents: payStay ? stayBalance : undefined,
        scope: payStay ? "folio" : undefined,
        full_stay: payStay && payFullStay ? true : undefined,
        expected_method: editing?.payment.method,
      }),
      closePayment,
      editing ? "PATCH" : "POST",
      editing ? "Abono corregido. Caja ya refleja el cambio." : "Abono registrado.",
    );
  }
  function paymentPath(payment: Payment, group: boolean) {
    return `/${group ? "stay-payments" : "payments"}/${payment.id}`;
  }
  function closePayment() {
    setError("");
    setShowRate(false);
    setPayStay(false);
    setPayFullStay(false);
    setEditing(null);
    setPayment(null);
    setVoiding(null);
    setRefunding(null);
    setShowService(false);
  }
  function submitRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!refunding) return;
    const fields = new FormData(event.currentTarget);
    void save(paymentPath(refunding.payment, refunding.group) + "/refunds", () => ({
      amount_cents: cents(String(fields.get("amount"))),
      reason: fields.get("reason"),
    }), closePayment, "POST", "Reembolso registrado. Se actualizó el saldo de la hoja.");
  }
  function paymentActions(record: Payment, group = false) {
    if (record.voided || record.retained_cents <= 0) return null;
    const canCorrect = record.retained_cents === record.amount_cents;
    return (
      <div className="row-actions">
        {canCorrect && user.role === "superadmin" && <button
          type="button" className="button secondary compact" disabled={busy}
          onClick={() => {
            closePayment();
            setEditing({ payment: record, group });
            setPaymentMethod(record.method);
            setAmountText((record.amount_cents / 100).toFixed(2));
          }}>
          Editar abono
        </button>}
        {record.method !== "A/C CAMILO" && <button type="button" className="button secondary compact" disabled={busy}
          onClick={() => { closePayment(); setRefundText(""); setRefunding({ payment: record, group }); }}>Reembolsar</button>}
        {!canCorrect && <small>Este abono ya tiene reembolsos.</small>}
        {canCorrect && user.role === "superadmin" && <button type="button" className="text-button" disabled={busy}
          onClick={() => {
            if (voiding === record.id)
              void save(paymentPath(record, group) + "/void", () => ({}), closePayment);
            else setVoiding(record.id);
          }}>
          {voiding === record.id ? "Confirmar anulación" : "Anular abono"}
        </button>}
      </div>
    );
  }
  const cancelled = folio.status === "cancelled";
  const base = /^\d{1,9}([.,]\d{1,2})?$/.test(amountText) ? cents(amountText) : 0;
  const refundAmount = /^\d{1,9}([.,]\d{1,2})?$/.test(refundText) ? cents(refundText) : 0;
  const balance = total("balance_cents");
  const camiloTotal = entries?.reduce((sum, row) => sum + row.camilo_cents, 0) ?? 0;
  const stayBalance = entries?.reduce((sum, row) => sum + (row.lodging_day ? row.balance_cents : 0), 0) ?? 0;
  const arrival = folio.joined_on ?? folio.check_in;
  const nights = daysBetween(arrival, folio.check_out);
  const dueCount = entries?.filter((row) => row.balance_cents > 0).length ?? 0;
  const visibleEntries = onlyDue ? entries?.filter((row) => row.balance_cents > 0) : entries;
  const hasHistory = !!(details?.stay_payments.length || details?.refunds.length);
  return (
    <Modal title={`Hoja de consumo #${folio.id}`} onClose={onClose} wide className="folio-dialog">
      <div className="folio-header">
        <div className="folio-identity">
          <span className={`tag ${folio.status}`}>{statusNames[folio.status]}</span>
          <h3>{folio.title}</h3>
          <p>Reserva #{folio.reservation_id} · {folio.platform_name} · {folio.folio_mode === "shared" ? "Cuenta conjunta" : "Cuenta individual"}</p>
          <p>{locations.join(" / ") || folio.room_name || "Habitación sin asignar"}</p>
          <p>{shortDate(arrival, true)} → {shortDate(folio.check_out, true)} · {nights} {nights === 1 ? "noche" : "noches"} · {folio.joined_on ? 1 : folio.pax + (folio.guest_id === null ? reservation?.added_guests.length ?? 0 : 0)} PAX</p>
          {folio.arrival_time && <p>Llegada prevista · {folio.arrival_time}</p>}
        </div>
        {entries && <dl className="folio-summary" aria-label="Resumen de la cuenta">
          <div><dt>Total de cargos</dt><dd>{money(total("total_cents"))}</dd></div>
          <div><dt>{camiloTotal > 0 ? "Abonos y cobertura" : "Abonos registrados"}</dt><dd>{money(total("paid_cents"))}</dd></div>
          {camiloTotal > 0 && <div><dt>A/C CAMILO · Hospedaje</dt><dd>{money(camiloTotal)}</dd></div>}
          {(balance > 0 || !camiloTotal) && <div className={balance > 0 ? "folio-balance-due" : ""}>
            <dt>{balance > 0 ? "Saldo pendiente" : "Saldo"}</dt><dd>{money(balance)}</dd>
          </div>}
        </dl>}
      </div>
      {reservation && <details className="folio-staff">
        <summary>Responsables de la estadía</summary>
        <ReservationStaff reservation={reservation} />
      </details>}
      {folio.nightly_cents === null && !folio.joined_on && (
        <p className="form-note">
          Registra la tarifa en la reserva para que aparezcan las noches de
          hospedaje.
        </p>
      )}
      {!refunding && !payment && !editing && !payStay && !removing && <ErrorBox message={error} />}
      <p className="folio-feedback" role="status">{notice}</p>
      {removing && <Modal title="Quitar consumo del Pub" onClose={() => { if (!busy) setRemoving(null); }}>
        <form className="form-stack" onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void save(`/services/${removing.service_id}/void`, () => ({ reason: values.get("reason") }),
            () => setRemoving(null), "POST", "Consumo anulado. Se devolvieron las unidades al stock del Pub.");
        }}>
          <ErrorBox message={error} />
          <p><strong>{removing.detail} · {money(removing.total_cents)}</strong></p>
          <p>Se quitará el cargo de esta hoja y sus unidades volverán al stock. El historial conservará la anulación.</p>
          <label>Motivo<input name="reason" maxLength={160} required autoFocus /></label>
          <div className="modal-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={() => setRemoving(null)}>Cancelar</button>
            <button className="button primary" disabled={busy}>Confirmar y quitar consumo</button>
          </div>
        </form>
      </Modal>}
      {!entries && !error && <p role="status">Cargando movimientos…</p>}
      {entries && (
        <section className="folio-movements">
          <div className="folio-toolbar-main">
            <div>
              <h3>Detalle de cargos</h3>
              <div className="folio-filters" role="group" aria-label="Filtrar cargos">
                <button type="button" aria-pressed={!onlyDue} onClick={() => setOnlyDue(false)}>Todos ({entries.length})</button>
                <button type="button" aria-pressed={onlyDue} onClick={() => setOnlyDue(true)}>Con saldo ({dueCount})</button>
              </div>
            </div>
            <div className="folio-toolbar-actions">
              {!cancelled && stayBalance > 0 && <button type="button" className="button primary compact" disabled={busy}
                onClick={() => {
                  closePayment();
                  setPayStay(true);
                  setPayFullStay(true);
                  setAmountText((stayBalance / 100).toFixed(2));
                  setPaymentMethod("");
                }}>Pagar estadía completa</button>}
              {user.role === "superadmin" && !cancelled && reservation && !folio.joined_on && <button type="button" className="button secondary compact"
                disabled={busy} aria-expanded={showRate} onClick={() => { const open = !showRate; closePayment(); setShowRate(open); }}>
                Ajustar tarifa de hospedaje
              </button>}
              {hasHistory && <button type="button" className="button secondary compact"
                onClick={() => historyHeading.current?.focus()}>Cobros y reembolsos</button>}
              {!cancelled && !!reservation?.room_assignments.length && stayBalance > 0 &&
                <button type="button" className="button secondary compact" disabled={busy} aria-expanded={payStay}
                  onClick={() => {
                    const open = !payStay;
                    closePayment();
                    setShowService(false);
                    setPayStay(open);
                    setAmountText("");
                    setPaymentMethod("");
                  }}>
                  {folio.status === "pending" || folio.status === "confirmed" ? "Registrar adelanto" : "Abonar hospedaje"}
                </button>}
              {!cancelled && <button type="button" className="button primary compact" aria-expanded={showService}
                disabled={busy} onClick={() => { const open = !showService; closePayment(); setShowService(open); }}>
                <Icon name="plus" size={16} /> Agregar servicio
              </button>}
            </div>
          </div>
          {showRate && reservation && <form className="form-stack folio-form" onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            void save("/lodging-rate", () => ({
              start: values.get("start"), end: values.get("end"),
              nightly_cents: cents(String(values.get("rate"))), expected_rates: reservation.night_rates,
              expected_base: reservation.nightly_cents,
            }), closePayment, "PATCH");
          }}>
            <h3>Ajustar tarifa de hospedaje</h3>
            <p>El último día del rango queda fuera del ajuste. Los abonos se conservan. En cuentas individuales, la tarifa total se reparte entre las hojas originales.</p>
            <div className="form-grid">
              <label>Desde la noche del<input type="date" name="start" min={folio.check_in} max={addDays(folio.check_out, -1)}
                defaultValue={reservation.moves.at(-1)?.day ?? folio.check_in} required /></label>
              <label>Hasta el día (excluido)<input type="date" name="end" min={addDays(folio.check_in, 1)}
                max={folio.check_out} defaultValue={folio.check_out} required /></label>
              <label>Tarifa total por noche (Bs)<input name="rate" inputMode="decimal"
                pattern="[0-9]{1,7}([.,][0-9]{1,2})?" required /></label>
            </div>
            <div className="modal-actions">
              <button type="button" className="button secondary" disabled={busy} onClick={closePayment}>Cancelar</button>
              <button className="button primary" disabled={busy}>Guardar tarifa</button>
            </div>
          </form>}
          {refunding && <Modal title="Registrar reembolso" className="folio-payment-dialog"
            onClose={() => { if (!busy) closePayment(); }}>
            <form className="form-stack" onSubmit={submitRefund}>
            <ErrorBox message={error} />
            <p className="folio-operation-summary"><strong>Disponible para devolver {money(refunding.payment.retained_cents)}</strong>
              <span>Abono del {shortDate(refunding.payment.day, true)} · Devolución por {refunding.payment.method}</span>
            </p>
            {refunding.group && <p>La devolución se aplica desde las últimas partidas del cobro de estadía.</p>}
            <div className="form-grid">
              <label>Importe a devolver (Bs)<input name="amount" inputMode="decimal" pattern="[0-9]{1,9}([.,][0-9]{1,2})?"
                value={refundText} onChange={(e) => setRefundText(e.target.value)} required autoFocus /></label>
              <label>Motivo<input name="reason" maxLength={160} required /></label>
            </div>
            <button type="button" className="button secondary compact" disabled={busy}
              onClick={() => setRefundText((refunding.payment.retained_cents / 100).toFixed(2))}>Usar importe completo</button>
            {refundAmount > refunding.payment.retained_cents && <ErrorBox message="El importe supera lo disponible para devolver." />}
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={closePayment} disabled={busy}>Cancelar</button>
              <button className="button primary" disabled={busy || !refundAmount || refundAmount > refunding.payment.retained_cents}>Registrar reembolso</button>
            </div>
            </form>
          </Modal>}
          {(payment || editing || payStay) && (
            <Modal title={editing ? "Editar abono" : payFullStay ? "Pagar estadía completa" : "Registrar abono"} className="folio-payment-dialog"
              onClose={() => { if (!busy) closePayment(); }}>
            <form
              key={editing ? `edit-${editing.payment.id}` : payStay ? "stay" : payment?.lodging_day ?? payment?.service_id}
              className="form-stack"
              onSubmit={submitPayment}
            >
              <ErrorBox message={error} />
              <p className="folio-operation-summary">
                <strong>{editing ? `Abono registrado · ${money(editing.payment.amount_cents)}` : `Saldo pendiente · ${money(payment?.balance_cents ?? stayBalance)}`}</strong>
                <span>{editing ? `${editing.payment.method} · ${shortDate(editing.payment.day, true)}`
                  : payment ? `${payment.service} · ${shortDate(payment.day, true)}` : `${nights} ${nights === 1 ? "noche" : "noches"} · ${folio.folio_mode === "individual" ? "Hospedaje de esta cuenta individual" : "Hospedaje de la cuenta conjunta"}`}</span>
              </p>
              {payFullStay && <p>Incluye el saldo de todas las noches de esta hoja y descuenta los abonos anteriores. Los servicios y consumos se pagan por separado.</p>}
              {editing?.group && <p>La corrección se aplica a todas las hojas vinculadas al cobro.</p>}
              <div className="form-grid">
                <label>
                  Fecha del abono
                  <input name="day" type="date" defaultValue={editing?.payment.day ?? today()} required />
                </label>
                <label>
                  Importe del abono (Bs)
                  <input
                    name="amount"
                    inputMode="decimal"
                    pattern={editing?.group || payStay ? "[0-9]{1,9}([.,][0-9]{1,2})?" : "[0-9]{1,7}([.,][0-9]{1,2})?"}
                    value={amountText}
                    readOnly={payFullStay}
                    onChange={(event) => setAmountText(event.target.value)}
                    required
                    autoFocus
                  />
                </label>
                <label>
                  Medio de pago
                  <select name="method" value={paymentMethod} required onChange={(event) => setPaymentMethod(event.target.value)}>
                    <option value="" disabled>Selecciona cómo se pagó</option>
                    {(payment?.service_id || editing?.payment.service_id ? paymentMethods : lodgingPaymentMethods).map(
                      (method) => (
                        <option key={method}>{method}</option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              {payStay && !payFullStay && !editing && <div className="row-actions">
                <button type="button" className="button secondary compact" disabled={busy}
                  onClick={() => setAmountText((stayBalance / 100).toFixed(2))}>Usar saldo completo</button>
              </div>}
              {!editing && base > (payment?.balance_cents ?? stayBalance) && <ErrorBox message="El importe supera el saldo pendiente." />}
              {!editing && base > 0 && base <= (payment?.balance_cents ?? stayBalance) && <p>
                Saldo después del abono · <strong>{money((payment?.balance_cents ?? stayBalance) - base)}</strong>
              </p>}
              {paymentMethod === "Tarjeta" && <CardCharge base={base} />}
              <div className="modal-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={closePayment} disabled={busy}
                >
                  Cancelar
                </button>
                <button className="button primary" disabled={busy || !base || !paymentMethod || (!editing && base > (payment?.balance_cents ?? stayBalance))}>
                  {editing ? "Guardar corrección" : payFullStay ? "Confirmar pago de estadía" : "Registrar abono"}
                </button>
              </div>
            </form>
            </Modal>
          )}
          {showService && (
            <form className="form-stack folio-form" onSubmit={submitService}>
              <h3>Agregar servicio</h3>
              <div className="form-grid">
                <label>
                  Fecha del servicio
                  <input name="day" type="date" defaultValue={today()} required />
                </label>
                <label>
                  Servicio
                  <input
                    name="service"
                    placeholder="Ej. Lavandería"
                    maxLength={80}
                    required
                    autoFocus
                  />
                </label>
                <label>
                  Detalle
                  <input name="detail" maxLength={500} required />
                </label>
                <label>
                  Total (Bs)
                  <input
                    name="total"
                    inputMode="decimal"
                    pattern="[0-9]{1,7}([.,][0-9]{1,2})?"
                    required
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="button secondary" onClick={closePayment} disabled={busy}>Cancelar</button>
                <button className="button primary" disabled={busy}>Registrar servicio</button>
              </div>
            </form>
          )}
          {!entries.length ? <p className="muted">Aún no hay cargos en esta hoja.</p> :
          !visibleEntries?.length ? <p className="muted">Todos los cargos están al día.</p> :
          <table className="folio-table" role="table" aria-label="Cargos de la hoja">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Servicio y fecha</th>
                <th role="columnheader" scope="col">Total</th>
                <th role="columnheader" scope="col">Abonado</th>
                <th role="columnheader" scope="col">Saldo</th>
                <th role="columnheader" scope="col">Responsables</th>
                <th role="columnheader" scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {visibleEntries.map((row) => {
                const cashiers = row.cashiers;
                return <tr role="row" key={row.lodging_day ?? row.service_id}>
                  <td role="cell" className="folio-charge-name">
                    <strong>{row.service}</strong>
                    <small className="cell-sub">{shortDate(row.day, true)} · {row.detail}</small>
                  </td>
                  <td role="cell" className="folio-amount" data-label="Total">{money(row.total_cents)}</td>
                  <td role="cell" className="folio-amount" data-label="Abonado">
                    {money(row.paid_cents)}
                    {!!row.stay_paid_cents && <small className="cell-sub">Incluido en cobro de estadía</small>}
                  </td>
                  <td role="cell" className={`folio-amount${row.balance_cents > 0 ? " folio-row-due" : ""}`} data-label="Saldo">
                    <strong>{row.balance_cents === 0 && row.camilo_cents > 0 ? "A/C CAMILO" : money(row.balance_cents)}</strong>
                    <small className="cell-sub">{row.balance_cents > 0 ? "Pendiente de pago" : row.camilo_cents > 0 ? "Hospedaje cubierto" : row.total_cents === 0 ? "Sin cargo" : "Pagado"}</small>
                  </td>
                  <td role="cell" className="folio-operators">
                    {row.author && <span className="folio-operator">Registro · {row.author}</span>}
                    {!!cashiers.length && <span className="folio-operator">Abono · {cashiers.join(", ")}</span>}
                    {!row.author && !cashiers.length && "—"}
                  </td>
                  <td role="cell" className="folio-charge-actions">
                    {user.role === "superadmin" && !!row.pub_charge && <button type="button" className="button secondary compact"
                      disabled={busy || row.paid_cents > 0} title={row.paid_cents > 0 ? "Reembolsa o anula primero los abonos del consumo." : undefined}
                      onClick={() => { closePayment(); setRemoving(row); }}>
                      Quitar consumo
                    </button>}
                    {!cancelled && row.balance_cents > 0 && (
                      <button
                        type="button"
                        className="button secondary compact"
                        aria-label={`Abonar ${row.service} del ${shortDate(row.day, true)}`}
                        disabled={busy}
                        onClick={() => {
                          closePayment();
                          setPayment(row);
                          setAmountText((row.balance_cents / 100).toFixed(2));
                          setPaymentMethod("");
                        }}
                      >
                        Registrar abono
                      </button>
                    )}
                    {row.payments.length > 0 && (
                      <details className="payment-history">
                        <summary>Gestionar abonos ({row.payments.length})</summary>
                        {row.payments.map((p) => (
                          <div key={p.id} className="folio-payment-item">
                            <strong>{money(p.amount_cents)} · {p.method}</strong>
                            <p>{shortDate(p.day, true)} · {p.author}
                            {p.surcharge_cents > 0 && ` · ${p.method === "Tarjeta" ? "Comisión descontada" : "Recargo histórico"} ${money(p.surcharge_cents)} · Cobrado ${money(p.amount_cents + p.surcharge_cents)}`}
                            {p.voided ? " · Anulado" : ""}
                            {p.retained_cents < p.amount_cents && ` · Reembolsado ${money(p.amount_cents - p.retained_cents)}`}</p>
                            {paymentActions(p)}
                          </div>
                        ))}
                      </details>
                    )}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>}
        </section>
      )}
      {hasHistory && <section className="folio-history">
        <h3 tabIndex={-1} ref={historyHeading}>Cobros de estadía y reembolsos</h3>
        {!!details?.stay_payments.length && <div className="folio-history-group">
          <h4>Cobros de estadía</h4>
          {details.stay_payments.map((record) => <article key={record.id} className="folio-history-item">
            <strong>{money(record.amount_cents)} · {record.method}</strong>
            <p>{shortDate(record.day)} · {record.method === "A/C CAMILO" ? "Registrado por" : "Cobrado por"} <strong>{record.author}</strong>{record.voided ? " · Anulado" : ""}</p>
            {record.retained_cents < record.amount_cents && <p>Reembolsado {money(record.amount_cents - record.retained_cents)}</p>}
            {record.folio_cents !== record.amount_cents && <p>Aplicado a esta hoja {money(record.folio_cents)}</p>}
            {record.surcharge_cents > 0 && <p>Comisión {money(record.surcharge_cents)} · Cobrado {money(record.amount_cents + record.surcharge_cents)}</p>}
            {paymentActions(record, true)}
          </article>)}
        </div>}
        {!!details?.refunds.length && <div className="folio-history-group">
          <h4>Reembolsos registrados</h4>
          {details.refunds.map((refund) => <article key={refund.id} className="folio-history-item">
            <strong>{money(refund.amount_cents)} · {refund.method}</strong>
            <p>{shortDate(refund.day, true)} · {refund.author} · Cobro #{refund.payment_id}</p>
            <p>{refund.reason}</p>
            {refund.folio_cents !== refund.amount_cents && <p>Aplicado a esta hoja {money(refund.folio_cents)}</p>}
          </article>)}
        </div>}
      </section>}
    </Modal>
  );
}
