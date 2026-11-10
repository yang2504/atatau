import { useEffect, useState, type FormEvent } from "react";
import { ErrorBox, Icon } from "../../components/UI";
import { CardCharge } from "../../components/CardCharge";
import { api, localDateTime, shortDate, today } from "../../lib/api";
import { cents, money, paymentMethods } from "../../lib/money";
import type { User } from "../../lib/types";

type Entry = {
  source: "manual" | "folio" | "stay" | "pop";
  id: number;
  day: string;
  kind: "income" | "expense";
  detail: string;
  cash_cents: number;
  surcharge_cents: number;
  method: string;
  author: string;
  voided: number;
  recorded_at: string | null;
};
type Turn = { id: number; started_at: string; ended_at: string | null; author: string };
const sources = { manual: "Manual", folio: "Hoja de consumo", stay: "Cobro de estadía", pop: "Venta Pub" };

export function Cash({ user }: { user: User }) {
  const admin = user.role !== "receptionist";
  const [box, setBox] = useState<"petty" | "pub">("petty");
  const boxLabel = box === "pub" ? "Caja Pub" : "Caja Chica";
  const [view, setView] = useState("current");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [kind, setKind] = useState("income");
  const [method, setMethod] = useState("Efectivo");
  const [amount, setAmount] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [turnId, setTurnId] = useState("");
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingTurns, setLoadingTurns] = useState(false);
  async function loadTurns(before?: number) {
    setError("");
    setLoadingTurns(true);
    try {
      const page = await api<Turn[]>(`/cash/turns${before ? `?before=${before}` : ""}`);
      setTurns((current) => before ? [...current, ...page] : page);
      setHasOlder(page.length === 50);
      if (!before) setTurnId(page[0] ? String(page[0].id) : "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingTurns(false);
    }
  }
  function switchView(next: string) {
    setError("");
    setView(next);
    if (next === "history") void loadTurns();
  }
  const byTurn = view === "current" || view === "history";
  const path = view === "monthly" ? `/cash/monthly?month=${month}&box=${box}`
    : byTurn ? (view === "current" || turnId) && `/cash/turns/${view === "current" ? "current" : turnId}?box=${box}`
    : `/cash/daily?box=${box}`;
  useEffect(() => {
    let active = true;
    setEntries(null);
    setTurn(null);
    if (!path) return;
    void api<Entry[] | (Turn & { entries: Entry[] })>(path).then((result) => {
      if (!active) return;
      if (Array.isArray(result)) setEntries(result);
      else {
        setTurn(result);
        setEntries(result.entries);
      }
    }).catch((error) => {
      if (active) setError(error.message);
    });
    return () => { active = false; };
  }, [path, version]);
  const base = /^\d{1,7}([.,]\d{1,2})?$/.test(amount) ? cents(amount) : 0;
  const total = (kind: Entry["kind"]) => (entries ?? []).reduce(
    (sum, row) => row.kind === kind && !row.voided ? sum + row.cash_cents : sum, 0,
  );
  function switchBox(next: typeof box) {
    if (box === next) return;
    setEntries(null);
    setError("");
    setBox(next);
  }

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await api("/cash", { day: values.get("day") ?? today(), detail: values.get("detail"), kind, method, base_cents: cents(amount), cash_box: box });
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
    <div className="tabs" aria-label="Elegir caja" role="group">
      <button className={box === "petty" ? "active" : ""} aria-pressed={box === "petty"} onClick={() => switchBox("petty")} disabled={busy}>Caja Chica</button>
      <button className={box === "pub" ? "active" : ""} aria-pressed={box === "pub"} onClick={() => switchBox("pub")} disabled={busy}>Caja Pub</button>
    </div>
    <div className="tabs" role="group" aria-label="Período de caja">
      <button className={view === "current" ? "active" : ""} aria-pressed={view === "current"} onClick={() => switchView("current")}>Mi turno</button>
      <button className={view === "history" ? "active" : ""} aria-pressed={view === "history"} onClick={() => switchView("history")}>Historial de turnos</button>
      {admin && <>
        <button className={view === "daily" ? "active" : ""} aria-pressed={view === "daily"} onClick={() => switchView("daily")}>Caja diaria</button>
        <button className={view === "monthly" ? "active" : ""} aria-pressed={view === "monthly"} onClick={() => switchView("monthly")}>Cuaderno mensual</button>
      </>}
    </div>
    <ErrorBox message={error} />
    <div className={view === "current" ? "content-columns operations-layout" : undefined}>
      <section className="panel">
        <div className="section-toolbar">
          <h2>{boxLabel} · {byTurn ? (turn ? `Turno #${turn.id}` : "Turnos") : view === "monthly" ? "Cuaderno mensual" : shortDate(today())}</h2>
          {view === "monthly" && <input type="month" aria-label="Mes del cuaderno" value={month} onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} />}
        </div>
        {view === "history" && <div className="row-actions turn-meta">
          <label>Turno<select aria-label="Turno" value={turnId} onChange={(e) => { setError(""); setTurnId(e.target.value); }} disabled={loadingTurns}>
            {!turns.length && <option value="">Sin turnos para mostrar</option>}
            {turns.map((item) => <option value={item.id} key={item.id}>
              #{item.id} · {item.author} · {localDateTime(item.started_at)}
            </option>)}
          </select></label>
          {hasOlder && <button className="button secondary" disabled={loadingTurns}
            onClick={() => void loadTurns(turns.at(-1)?.id)}>Ver turnos anteriores</button>}
        </div>}
        {turn && <p className="muted turn-meta">
          {turn.author} · Apertura {localDateTime(turn.started_at)} · {turn.ended_at ? `Cierre ${localDateTime(turn.ended_at)}` : "Turno abierto"}
        </p>}
        <div className="ledger-totals">
          {byTurn && <span>Saldo inicial <strong>{money(0)}</strong></span>}
          <span>Ingresos <strong>{entries ? money(total("income")) : "—"}</strong></span>
          <span>Egresos <strong>{entries ? money(total("expense")) : "—"}</strong></span>
          <span>Neto de caja <strong>{entries ? money(total("income") - total("expense")) : "—"}</strong></span>
        </div>
        {!entries && !error && <p className="quiet-state" role="status">Cargando movimientos…</p>}
        {entries?.length === 0 && <p className="quiet-state">Aún no hay movimientos en este período.</p>}
        {!!entries?.length && <div className="table-scroll">
          <table>
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Medio</th><th>Importe en caja</th>{admin && <th>Acción</th>}</tr></thead>
            <tbody>{entries.map((row) => <tr key={`${row.source}-${row.id}`} className={row.voided ? "void-row" : ""}>
              <td>{shortDate(row.day, byTurn)}{row.recorded_at && <small className="cell-sub">Registro {localDateTime(row.recorded_at)}</small>}</td>
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
      {view === "current" && <section className="panel side-form">
        <h2>{admin ? "Nuevo movimiento" : "Registrar ingreso"} · {boxLabel}</h2>
        <p className="muted">{box === "pub" ? "Las ventas de Inventario Pub entran aquí automáticamente." : "Los abonos de huéspedes entran aquí automáticamente."}</p>
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
      </section>}
    </div>
  </div>;
}
