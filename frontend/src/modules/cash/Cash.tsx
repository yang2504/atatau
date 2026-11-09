import { useEffect, useState, type FormEvent } from "react";
import { ErrorBox, Icon } from "../../components/UI";
import { CardCharge } from "../../components/CardCharge";
import { api, shortDate, today } from "../../lib/api";
import { cents, money, paymentMethods } from "../../lib/money";
import type { User } from "../../lib/types";

type Entry = {
  source: "manual" | "folio" | "pop";
  id: number;
  day: string;
  kind: "income" | "expense";
  detail: string;
  cash_cents: number;
  surcharge_cents: number;
  method: string;
  author: string;
  voided: number;
};
const sources = { manual: "Manual", folio: "Hoja de consumo", pop: "POP" };

export function Cash({ user }: { user: User }) {
  const admin = user.role !== "receptionist";
  const [view, setView] = useState("daily");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [kind, setKind] = useState("income");
  const [method, setMethod] = useState("Efectivo");
  const [amount, setAmount] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const path = view === "monthly" ? `/cash/monthly?month=${month}` : "/cash/daily";
  useEffect(() => {
    let active = true;
    setEntries(null);
    void api<Entry[]>(path).then((rows) => {
      if (active) setEntries(rows);
    }).catch((error) => {
      if (active) setError(error.message);
    });
    return () => { active = false; };
  }, [path, version]);
  const base = /^\d{1,7}([.,]\d{1,2})?$/.test(amount) ? cents(amount) : 0;
  const total = (kind: Entry["kind"]) => (entries ?? []).reduce(
    (sum, row) => row.kind === kind && !row.voided ? sum + row.cash_cents : sum, 0,
  );

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await api("/cash", { day: values.get("day") ?? today(), detail: values.get("detail"), kind, method, base_cents: cents(amount) });
      form.reset();
      setAmount("");
      setVersion((v) => v + 1);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function voidEntry(id: number) {
    if (!window.confirm("¿Anular este movimiento manual? Se conservará en el historial.")) return;
    setBusy(true);
    setError("");
    try {
      await api(`/cash/${id}/void`, {});
      setVersion((v) => v + 1);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="form-stack">
    {admin && <div className="tabs">
      <button className={view === "daily" ? "active" : ""} onClick={() => { setView("daily"); setError(""); }}>Caja diaria</button>
      <button className={view === "monthly" ? "active" : ""} onClick={() => { setView("monthly"); setError(""); }}>Cuaderno mensual</button>
    </div>}
    <ErrorBox message={error} />
    <div className="content-columns operations-layout">
      <section className="panel">
        <div className="section-toolbar">
          <h2>{view === "monthly" ? "Cuaderno mensual" : `Caja diaria · ${shortDate(today())}`}</h2>
          {view === "monthly" && <input type="month" aria-label="Mes del cuaderno" value={month} onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} />}
        </div>
        <div className="ledger-totals">
          <span>Ingresos <strong>{entries ? money(total("income")) : "—"}</strong></span>
          {admin && <>
            <span>Egresos <strong>{entries ? money(total("expense")) : "—"}</strong></span>
            <span>Neto <strong>{entries ? money(total("income") - total("expense")) : "—"}</strong></span>
          </>}
        </div>
        {!entries && !error && <p className="quiet-state" role="status">Cargando movimientos…</p>}
        {entries?.length === 0 && <p className="quiet-state">Aún no hay movimientos en este período.</p>}
        {!!entries?.length && <div className="table-scroll">
          <table>
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Medio</th><th>Importe en caja</th>{admin && <th>Acción</th>}</tr></thead>
            <tbody>{entries.map((row) => <tr key={`${row.source}-${row.id}`} className={row.voided ? "void-row" : ""}>
              <td>{shortDate(row.day)}</td>
              <td><strong>{row.detail}</strong><small className="cell-sub">{sources[row.source]} · {row.author}{row.voided ? " · Anulado" : ""}</small></td>
              <td>{row.method}</td>
              <td>{row.kind === "expense" ? "−" : ""}{money(row.cash_cents)}
                {row.surcharge_cents > 0 && <small className="cell-sub">
                  {row.method === "Tarjeta" ? "Comisión descontada" : "Recargo histórico"} {money(row.surcharge_cents)}
                </small>}
              </td>
              {admin && <td>{row.source === "manual" && !row.voided && <button className="text-button" disabled={busy} onClick={() => void voidEntry(row.id)}>Anular</button>}</td>}
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
      <section className="panel side-form">
        <h2>{admin ? "Nuevo movimiento" : "Registrar ingreso"}</h2>
        <p className="muted">Los abonos de huéspedes y las ventas del POP aparecen aquí automáticamente.</p>
        <form className="form-stack" onSubmit={record}>
          {admin && <><label>Fecha<input type="date" name="day" defaultValue={today()} required /></label>
          <label>Tipo<select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="income">Ingreso</option><option value="expense">Egreso</option>
          </select></label></>}
          <label>Concepto<input name="detail" placeholder="Ej. Compra de insumos" maxLength={160} required /></label>
          <label>Importe base (Bs)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" pattern="[0-9]{1,7}([.,][0-9]{1,2})?" required /></label>
          <label>Medio de pago<select value={method} onChange={(e) => setMethod(e.target.value)}>{paymentMethods.map((item) => <option key={item}>{item}</option>)}</select></label>
          {kind === "income" && method === "Tarjeta" && <CardCharge base={base} />}
          <button className="button primary" disabled={busy}><Icon name="plus" size={16} /> Registrar</button>
        </form>
      </section>
    </div>
  </div>;
}
