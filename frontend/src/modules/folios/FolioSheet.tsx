import { useEffect, useState, type FormEvent } from "react";
import { ErrorBox, Modal } from "../../components/UI";
import { api, daysBetween, shortDate, statusNames, today } from "../../lib/api";
import { cents, money, paymentMethods } from "../../lib/money";
import { CardCharge } from "../../components/CardCharge";
import { ReservationStaff } from "../reservations/ReservationStaff";
import type { Data, Folio, FolioEntry, Payment, StayPayment, User } from "../../lib/types";

type FolioDetails = { entries: FolioEntry[]; stay_payments: StayPayment[] };

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
  const [paymentMethod, setPaymentMethod] = useState("Efectivo");
  const [amountText, setAmountText] = useState("");
  const [voiding, setVoiding] = useState<number | null>(null);
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
  const locations = data.rooms.flatMap((room) =>
    room.units
      .filter((unit) => reservation?.unit_ids.includes(unit.id))
      .map((unit) => `${room.name} · ${unit.label}`),
  );
  const total = (key: "paid_cents" | "balance_cents" | "total_cents") =>
    (entries ?? []).reduce((sum, row) => sum + row[key], 0);
  async function save(endpoint: string, body: () => unknown, done: () => void, method = "POST") {
    setBusy(true);
    setError("");
    try {
      await api(path + endpoint, body(), method);
      done();
      setDetails(await api<FolioDetails>(path));
      await onSaved();
    } catch (error) {
      setError((error as Error).message);
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
      () => form.reset(),
    );
  }
  function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payment && !editing) return;
    const values = new FormData(event.currentTarget);
    void save(
      editing ? paymentPath(editing.payment, editing.group) : "/payments",
      () => ({
        lodging_day: payment?.lodging_day,
        service_id: payment?.service_id,
        day: values.get("day"),
        method: values.get("method"),
        amount_cents: cents(String(values.get("amount"))),
      }),
      closePayment,
      editing ? "PATCH" : "POST",
    );
  }
  function paymentPath(payment: Payment, group: boolean) {
    return `/${group ? "stay-payments" : "payments"}/${payment.id}`;
  }
  function closePayment() {
    setEditing(null);
    setPayment(null);
    setVoiding(null);
  }
  function paymentActions(record: Payment, group = false) {
    if (record.voided || user.role === "receptionist") return null;
    return (
      <div className="row-actions">
        {user.role === "superadmin" && <button
          type="button" className="text-button" disabled={busy}
          onClick={() => {
            setPayment(null);
            setVoiding(null);
            setEditing({ payment: record, group });
            setPaymentMethod(record.method);
            setAmountText((record.amount_cents / 100).toFixed(2));
          }}>
          Editar abono
        </button>}
        <button type="button" className="text-button" disabled={busy}
          onClick={() => {
            if (voiding === record.id)
              void save(paymentPath(record, group) + "/void", () => ({}), closePayment);
            else setVoiding(record.id);
          }}>
          {voiding === record.id ? "Confirmar anulación" : "Anular abono"}
        </button>
      </div>
    );
  }
  const cancelled = folio.status === "cancelled";
  const base = /^\d{1,9}([.,]\d{1,2})?$/.test(amountText) ? cents(amountText) : 0;
  const balance = total("balance_cents");
  const nights = daysBetween(folio.check_in, folio.check_out);
  return (
    <Modal title={`Hoja de consumo #${folio.id}`} onClose={onClose} wide>
      <div className="folio-header">
        <div>
          <h3>{folio.title}</h3>
          <p>
            Reserva #{folio.reservation_id} · {folio.platform_name}
          </p>
        </div>
        <span className={`tag ${folio.status}`}>
          {statusNames[folio.status]}
        </span>
        <p>
          {folio.pax} PAX en la reserva ·{" "}
          {nights} {nights === 1 ? "noche" : "noches"} ·{" "}
          {shortDate(folio.check_in, true)} → {shortDate(folio.check_out, true)}
        </p>
        <p>Hora prevista de llegada · {folio.arrival_time || "Sin programar"}</p>
        <p>{locations.join(" / ")}</p>
      </div>
      {reservation && <ReservationStaff reservation={reservation} />}
      {folio.nightly_cents === null && (
        <p className="form-note">
          Registra la tarifa en la reserva para que aparezcan las noches de
          hospedaje.
        </p>
      )}
      <ErrorBox message={error} />
      {!entries && !error && <p role="status">Cargando movimientos…</p>}
      {entries && <dl className="folio-summary" aria-label="Resumen de la cuenta">
        <div><dt>Total de cargos</dt><dd>{money(total("total_cents"))}</dd></div>
        <div><dt>Abonos registrados</dt><dd>{money(total("paid_cents"))}</dd></div>
        <div className={balance > 0 ? "folio-balance-due" : "folio-balance-paid"}>
          <dt>Saldo pendiente</dt><dd>{money(balance)}</dd>
        </div>
      </dl>}
      {!!details?.stay_payments.length && <section className="folio-form form-stack">
        <h3>Cobros de estadía</h3>
        {details.stay_payments.map((record) => <article key={record.id} className="form-note">
          <strong>{money(record.amount_cents)} · {record.method}</strong>
          <p>{shortDate(record.day)} · {record.author}{record.voided ? " · Anulado" : ""}</p>
          {record.folio_cents !== record.amount_cents && <p>Aplicado a esta hoja {money(record.folio_cents)}</p>}
          {record.surcharge_cents > 0 && <p>Comisión {money(record.surcharge_cents)} · Cobrado {money(record.amount_cents + record.surcharge_cents)}</p>}
          {paymentActions(record, true)}
        </article>)}
      </section>}
      {entries && (
        <section className="folio-movements">
          <h3>Detalle de cargos</h3>
          {!entries.length ? <p className="muted">Aún no hay cargos en esta hoja.</p> :
          <div className="table-scroll">
          <table className="folio-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Servicio</th>
                <th>Total</th>
                <th>Abonado</th>
                <th>Saldo</th>
                <th>Responsables</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => {
                const cashiers = [...new Set(row.payments.filter((p) => !p.voided).map((p) => p.author))];
                return <tr key={row.lodging_day ?? row.service_id}>
                  <td>{shortDate(row.day, true)}</td>
                  <td>
                    <strong className={row.balance_cents > 0 ? "unpaid-charge" : undefined}>{row.service}</strong>
                    <small className="cell-sub">{row.detail}</small>
                  </td>
                  <td>{money(row.total_cents)}</td>
                  <td>
                    {money(row.paid_cents)}
                    {!!row.stay_paid_cents && <small className="cell-sub">Incluido en cobro de estadía</small>}
                  </td>
                  <td className={row.balance_cents > 0 ? "folio-row-due" : undefined}>
                    <strong>{money(row.balance_cents)}</strong>
                    <small className="cell-sub">{row.balance_cents > 0 ? "Pendiente de pago" : row.total_cents === 0 ? "Sin cargo" : "Pagado"}</small>
                  </td>
                  <td>
                    {row.author && <span className="folio-operator">Registro · {row.author}</span>}
                    {!!cashiers.length && <span className="folio-operator">Abono · {cashiers.join(", ")}</span>}
                    {!row.author && !cashiers.length && "—"}
                  </td>
                  <td>
                    {!cancelled && row.balance_cents > 0 && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setPayment(row);
                          setEditing(null);
                          setAmountText((row.balance_cents / 100).toFixed(2));
                          setPaymentMethod("Efectivo");
                          setVoiding(null);
                        }}
                      >
                        Abonar
                      </button>
                    )}
                    {row.payments.length > 0 && (
                      <details className="payment-history">
                        <summary>Ver abonos</summary>
                        {row.payments.map((p) => (
                          <div key={p.id}>
                            {shortDate(p.day)} · {money(p.amount_cents)} ·{" "}
                            {p.method} · {p.author}
                            {p.surcharge_cents > 0 && ` · ${p.method === "Tarjeta" ? "Comisión descontada" : "Recargo histórico"} ${money(p.surcharge_cents)} · Cobrado ${money(p.amount_cents + p.surcharge_cents)}`}
                            {p.voided ? " · Anulado" : ""}
                            {paymentActions(p)}
                          </div>
                        ))}
                      </details>
                    )}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
          </div>}
        </section>
      )}
      {(payment || editing) && (
        <form
          key={editing ? `edit-${editing.payment.id}` : payment?.lodging_day ?? payment?.service_id}
          className="form-stack folio-form"
          onSubmit={submitPayment}
        >
          <h3>
            {editing ? (editing.group ? "Editar cobro de estadía" : "Editar abono")
              : payment && `Abonar · ${payment.service} del ${shortDate(payment.day)}`}
          </h3>
          {payment && <p>Saldo disponible · {money(payment.balance_cents)}</p>}
          {editing?.group && <p>La corrección se aplica a todas las hojas vinculadas al cobro.</p>}
          <div className="form-grid">
            <label>
              Fecha del abono
              <input name="day" type="date" defaultValue={editing?.payment.day ?? today()} required />
            </label>
            <label>
              Abono (Bs)
              <input
                name="amount"
                inputMode="decimal"
                pattern={editing?.group ? "[0-9]{1,9}([.,][0-9]{1,2})?" : "[0-9]{1,7}([.,][0-9]{1,2})?"}
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
                required
                autoFocus
              />
            </label>
            <label>
              Pago con
              <select name="method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                {paymentMethods.map(
                  (method) => (
                    <option key={method}>{method}</option>
                  ),
                )}
              </select>
            </label>
          </div>
          {paymentMethod === "Tarjeta" && <CardCharge base={base} />}
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              onClick={closePayment}
            >
              Cancelar
            </button>
            <button className="button primary" disabled={busy}>
              {editing ? "Guardar corrección" : "Registrar abono"}
            </button>
          </div>
        </form>
      )}
      {!cancelled && !payment && !editing && (
        <details className="folio-form">
          <summary>Agregar servicio</summary>
          <form className="form-stack" onSubmit={submitService}>
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
            <button className="button primary" disabled={busy}>
              Registrar servicio
            </button>
          </form>
        </details>
      )}
    </Modal>
  );
}
