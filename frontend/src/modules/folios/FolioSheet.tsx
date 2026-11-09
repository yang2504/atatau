import { useEffect, useState, type FormEvent } from "react";
import { ErrorBox, Modal } from "../../components/UI";
import { api, daysBetween, shortDate, statusNames, today } from "../../lib/api";
import { cents, money, paymentMethods } from "../../lib/money";
import { CardCharge } from "../../components/CardCharge";
import type { Data, Folio, FolioEntry, User } from "../../lib/types";

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
  const [entries, setEntries] = useState<FolioEntry[] | null>(null);
  const [payment, setPayment] = useState<FolioEntry | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("Efectivo");
  const [amountText, setAmountText] = useState("");
  const [voiding, setVoiding] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const path = `/folios/${folio.id}`;
  useEffect(() => {
    api<{ entries: FolioEntry[] }>(path)
      .then((result) => setEntries(result.entries))
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
  async function save(endpoint: string, body: () => unknown, done: () => void) {
    setBusy(true);
    setError("");
    try {
      await api(path + endpoint, body());
      done();
      const result = await api<{ entries: FolioEntry[] }>(path);
      setEntries(result.entries);
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
    if (!payment) return;
    const values = new FormData(event.currentTarget);
    void save(
      "/payments",
      () => ({
        lodging_day: payment.lodging_day,
        service_id: payment.service_id,
        day: values.get("day"),
        method: values.get("method"),
        amount_cents: cents(String(values.get("amount"))),
      }),
      () => setPayment(null),
    );
  }
  const cancelled = folio.status === "cancelled";
  const base = /^\d{1,7}([.,]\d{1,2})?$/.test(amountText) ? cents(amountText) : 0;
  return (
    <Modal title={`Hoja de consumo #${folio.id}`} onClose={onClose} wide>
      <div className="folio-header">
        <div>
          <strong>{folio.title}</strong>
          <p>
            Reserva #{folio.reservation_id} · {folio.platform_name}
          </p>
        </div>
        <span className={`tag ${folio.status}`}>
          {statusNames[folio.status]}
        </span>
        <p>
          {folio.pax} PAX en la reserva ·{" "}
          {daysBetween(folio.check_in, folio.check_out)} noches ·{" "}
          {shortDate(folio.check_in)} → {shortDate(folio.check_out)}
        </p>
        <p>Hora de llegada · {folio.arrival_time || "Por registrar"}</p>
        <p>{locations.join(" / ")}</p>
      </div>
      {folio.nightly_cents === null && (
        <p className="form-note">
          Registra la tarifa en la reserva para que aparezcan las noches de
          hospedaje.
        </p>
      )}
      <ErrorBox message={error} />
      {!entries && !error && <p role="status">Cargando movimientos…</p>}
      {entries && (
        <div className="table-scroll">
          <table className="folio-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Servicio</th>
                <th>Detalle</th>
                <th>A/C</th>
                <th>Saldo</th>
                <th>Total</th>
                <th>Pago con</th>
                <th>Recepcionista</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => (
                <tr key={row.lodging_day ?? row.service_id}>
                  <td>{shortDate(row.day)}</td>
                  <td>{row.service}</td>
                  <td>{row.detail}</td>
                  <td>{money(row.paid_cents)}</td>
                  <td>{money(row.balance_cents)}</td>
                  <td>{money(row.total_cents)}</td>
                  <td>
                    {[
                      ...new Set(
                        row.payments
                          .filter((p) => !p.voided)
                          .map((p) => p.method),
                      ),
                    ].join(", ") || "—"}
                  </td>
                  <td>
                    {[
                      ...new Set(
                        [
                          row.author,
                          ...row.payments
                            .filter((p) => !p.voided)
                            .map((p) => p.author),
                        ].filter(Boolean),
                      ),
                    ].join(", ") || "—"}
                  </td>
                  <td>
                    {!cancelled && row.balance_cents > 0 && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setPayment(row);
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
                            {!p.voided &&
                              user.role !== "receptionist" &&
                              (voiding === p.id ? (
                                <button
                                  type="button"
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() =>
                                    void save(
                                      `/payments/${p.id}/void`,
                                      () => ({}),
                                      () => {
                                        setVoiding(null);
                                        setPayment(null);
                                      },
                                    )
                                  }
                                >
                                  Confirmar anulación
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => setVoiding(p.id)}
                                >
                                  Anular abono
                                </button>
                              ))}
                          </div>
                        ))}
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={3}>Totales de la hoja</th>
                <td>{money(total("paid_cents"))}</td>
                <td>{money(total("balance_cents"))}</td>
                <td>{money(total("total_cents"))}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {payment && (
        <form
          key={payment.lodging_day ?? payment.service_id}
          className="form-stack folio-form"
          onSubmit={submitPayment}
        >
          <h3>
            Abonar · {payment.service} del {shortDate(payment.day)}
          </h3>
          <p>Saldo disponible · {money(payment.balance_cents)}</p>
          <div className="form-grid">
            <label>
              Fecha del abono
              <input name="day" type="date" defaultValue={today()} required />
            </label>
            <label>
              Abono (Bs)
              <input
                name="amount"
                inputMode="decimal"
                pattern="[0-9]{1,7}([.,][0-9]{1,2})?"
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
              onClick={() => setPayment(null)}
            >
              Cancelar
            </button>
            <button className="button primary" disabled={busy}>
              Registrar abono
            </button>
          </div>
        </form>
      )}
      {!cancelled && !payment && (
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
