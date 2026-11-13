import { useEffect, useState, type FormEvent } from "react";
import { ErrorBox, Icon, Modal } from "../../components/UI";
import { CardCharge } from "../../components/CardCharge";
import { api, localDateTime, shortDate, today } from "../../lib/api";
import { cents, money, paymentMethods } from "../../lib/money";
import type { User } from "../../lib/types";

type Entry = {
  source: "manual" | "folio" | "stay" | "pop" | "refund";
  id: number;
  day: string;
  kind: "income" | "expense";
  detail: string;
  base_cents: number;
  physical_cents: number;
  surcharge_cents: number;
  method: string;
  author: string;
  voided: number;
  recorded_at: string | null;
};
type Turn = {
  id: number | null; started_at: string | null; expires_at: string | null; ended_at: string | null;
  author: string; window_key: string | null; refresh_at?: string | null;
};
type HistoricalTurn = Turn & { id: number; started_at: string; expires_at: string };
const outsideSchedule = (turn: Turn) => /^(outside|extra):/.test(turn.window_key ?? "");
const sources = { manual: "Manual", folio: "Hoja de consumo", stay: "Cobro de estadía", pop: "Venta Pub", refund: "Reembolso" };
const transferMethods = paymentMethods.filter((method) => method !== "Efectivo");

export function Cash({ user }: { user: User }) {
  const admin = user.role !== "receptionist";
  const [box, setBox] = useState<"petty" | "pub">("petty");
  const boxLabel = box === "pub" ? "Caja Pub" : "Caja Chica";
  const [view, setView] = useState("current");
  const [movementFilter, setMovementFilter] = useState<"all" | Entry["kind"]>("all");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [movementKind, setMovementKind] = useState<Entry["kind"] | null>(null);
  const [voiding, setVoiding] = useState<Entry | null>(null);
  const [notice, setNotice] = useState("");
  const [account, setAccount] = useState<"cash" | "transfer">("cash");
  const [transferMethod, setTransferMethod] = useState("QR");
  const method = transferMethod;
  const [amount, setAmount] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [turns, setTurns] = useState<HistoricalTurn[]>([]);
  const [turnId, setTurnId] = useState("");
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingTurns, setLoadingTurns] = useState(false);
  async function loadTurns(before?: number) {
    setError("");
    setLoadingTurns(true);
    try {
      const page = await api<HistoricalTurn[]>(`/cash/turns${before ? `?before=${before}` : ""}`);
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
  function openMovement(kind: Entry["kind"]) {
    setError("");
    setNotice("");
    setAmount("");
    setTransferMethod(account === "cash" ? "Efectivo" : "QR");
    setMovementKind(kind);
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
  useEffect(() => {
    if (view !== "current" || !turn?.refresh_at) return;
    const timer = window.setTimeout(() => setVersion((value) => value + 1),
      Math.max(1000, Date.parse(turn.refresh_at) - Date.now() + 100));
    return () => window.clearTimeout(timer);
  }, [view, turn]);
  const base = /^\d{1,7}([.,]\d{1,2})?$/.test(amount) ? cents(amount) : 0;
  const incomeByMethod = new Map<string, number>();
  let income = 0;
  let expenses = 0;
  const accountEntries = entries?.filter((row) => (row.method === "Efectivo") === (account === "cash"));
  for (const row of accountEntries ?? []) {
    if (row.voided) continue;
    if (row.kind === "income") {
      income += row.base_cents;
      incomeByMethod.set(row.method, (incomeByMethod.get(row.method) ?? 0) + row.base_cents);
    } else {
      expenses += row.base_cents;
    }
  }
  const visibleEntries = accountEntries?.filter((row) => movementFilter === "all" || row.kind === movementFilter);
  const total = (amount: number) => entries ? money(amount) : "—";
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
      await api("/cash", { day: values.get("day") ?? today(), detail: values.get("detail"), kind: movementKind, method, base_cents: cents(amount), cash_box: box });
      form.reset();
      setAmount("");
      setAccount(method === "Efectivo" ? "cash" : "transfer");
      setMovementFilter(movementKind ?? "all");
      setMovementKind(null);
      setNotice(movementKind === "expense" ? "Egreso registrado." : "Ingreso registrado.");
      setVersion((v) => v + 1);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function voidEntry(id: number) {
    setBusy(true);
    setError("");
    try {
      await api(`/cash/${id}/void`, {});
      setVoiding(null);
      setNotice("Movimiento anulado.");
      setVersion((v) => v + 1);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="form-stack cash-workspace">
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
    {!movementKind && !voiding && <ErrorBox message={error} />}
    {notice && <p className="group-booking-summary" role="status">{notice}</p>}
    <div>
      <section className="panel">
        <div className="section-toolbar">
          <div>
            <h2>{boxLabel} · {byTurn ? (turn?.id ? `Turno #${turn.id}` : view === "current" ? "Mi turno" : "Historial de turnos") : view === "monthly" ? "Cuaderno mensual" : shortDate(today())}</h2>
            <p className="muted">{box === "pub" ? "Ventas del Pub y abonos de sus consumos a cuenta." : "Hospedaje, servicios e ingresos de recepción."}</p>
          </div>
          {view === "current" && turn?.started_at && <div className="row-actions">
            {box === "petty" && <button className="button primary" onClick={() => openMovement("income")}><Icon name="plus" size={16} /> Registrar ingreso</button>}
            {admin && <button className="button secondary" onClick={() => openMovement("expense")}>Registrar egreso</button>}
          </div>}
          {view === "monthly" && <input type="month" aria-label="Mes del cuaderno" value={month} onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} />}
        </div>
        {view === "history" && <div className="row-actions turn-meta">
          <label>Turno<select aria-label="Turno" value={turnId} onChange={(e) => { setError(""); setTurnId(e.target.value); }} disabled={loadingTurns}>
            {!turns.length && <option value="">Sin turnos para mostrar</option>}
            {turns.map((item) => <option value={item.id} key={item.id}>
              #{item.id} · {item.author} · {item.started_at && localDateTime(item.started_at)}{outsideSchedule(item) ? " · Fuera de horario" : ""}
            </option>)}
          </select></label>
          {hasOlder && <button className="button secondary" disabled={loadingTurns}
            onClick={() => void loadTurns(turns.at(-1)?.id)}>Ver turnos anteriores</button>}
        </div>}
        {turn?.started_at && turn.expires_at && <p className="muted turn-meta">
          {turn.author} · {outsideSchedule(turn) ? "Fuera de horario · " : ""}
          {localDateTime(turn.started_at)} → {localDateTime(turn.ended_at ?? turn.expires_at)}
          {turn.id === null ? " · Aún sin movimientos" : turn.ended_at ? " · Cerrado" : ""}
        </p>}
        {view === "current" && turn && !turn.started_at && <p className="muted turn-meta">El turno de este horario ya cerró. Revisa el horario en Turnos.</p>}
        <div className="tabs ledger-tabs" role="group" aria-label="Cuenta por medio de pago">
          <button className={account === "cash" ? "active" : ""} aria-pressed={account === "cash"}
            onClick={() => setAccount("cash")} disabled={busy}>Efectivo</button>
          <button className={account === "transfer" ? "active" : ""} aria-pressed={account === "transfer"}
            onClick={() => setAccount("transfer")} disabled={busy}>Transferencia</button>
        </div>
        <section className={`ledger-summary${account === "transfer" ? " ledger-other" : ""}`} aria-label={account === "cash" ? "Efectivo en caja" : "Transferencia"}>
          <h3>{account === "cash" ? "Efectivo en caja" : "Transferencia"}</h3>
          <div className="ledger-totals">
            <span>Ingresos <strong>{total(income)}</strong></span>
            <button type="button" className="ledger-expenses cash-expense-link" aria-pressed={movementFilter === "expense"}
              onClick={() => setMovementFilter(movementFilter === "expense" ? "all" : "expense")}>
              Egresos <strong>{total(expenses)}</strong>
            </button>
            <span className="ledger-net">Neto del período <strong>{total(income - expenses)}</strong></span>
          </div>
          {account === "cash" && byTurn && <p className="muted">Saldo inicial del turno · {money(0)}</p>}
          {account === "transfer" && <p className="muted">
            {transferMethods.map((medium) => `${medium} ${total(incomeByMethod.get(medium) ?? 0)}`).join(" · ")}
            {" · Ingresos por medio al importe base"}
          </p>}
        </section>
        <div className="tabs ledger-tabs" role="group" aria-label="Tipo de movimiento">
          {([["all", "Todos"], ["income", "Ingresos"], ["expense", "Egresos"]] as const).map(([value, label]) =>
            <button key={value} className={movementFilter === value ? "active" : ""}
              aria-pressed={movementFilter === value} onClick={() => setMovementFilter(value)}>{label}</button>)}
        </div>
        {movementFilter === "expense" && <div className="cash-expense-heading">
          <h3>Egresos del período</h3>
          <span>{accountEntries?.filter((row) => row.kind === "expense" && !row.voided).length ?? 0} vigentes · {total(expenses)}</span>
        </div>}
        {!entries && !error && <p className="quiet-state" role="status">Cargando movimientos…</p>}
        {visibleEntries?.length === 0 && <p className="quiet-state">{accountEntries?.length ? "No hay movimientos de este tipo." : "Aún no hay movimientos en esta cuenta."}</p>}
        {!!visibleEntries?.length && <div className="table-scroll">
          <table>
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Medio</th><th>Importe base</th>{admin && <th>Acción</th>}</tr></thead>
            <tbody>{visibleEntries.map((row) => <tr key={`${row.source}-${row.id}`} className={row.voided ? "void-row" : row.kind === "expense" ? "ledger-expense-row" : undefined}>
              <td>{shortDate(row.day, byTurn)}{row.recorded_at && <small className="cell-sub">Registro {localDateTime(row.recorded_at)}</small>}</td>
              <td><span className={`tag ledger-kind ${row.kind}`}>{row.kind === "expense" ? "Egreso" : "Ingreso"}</span>
                <strong>{row.detail}</strong><small className="cell-sub">
                  {box === "pub" && row.source === "manual" && row.kind === "income" ? "Ingreso manual histórico" : sources[row.source]}
                  {" · "}{row.author}{row.voided ? " · Anulado" : ""}</small></td>
              <td>{row.method}</td>
              <td><strong>{row.kind === "expense" ? "−" : "+"}{money(row.base_cents)}</strong>
                {row.surcharge_cents > 0 && <small className="cell-sub">
                  {row.method === "Tarjeta" ? "Comisión descontada" : "Recargo histórico"} {money(row.surcharge_cents)}
                </small>}
              </td>
              {admin && <td>{row.source === "manual" && !row.voided && <button className="text-button" disabled={busy}
                onClick={() => { setError(""); setVoiding(row); }}>Anular</button>}</td>}
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
      {movementKind && <Modal title={`${movementKind === "expense" ? "Registrar egreso" : "Registrar ingreso"} · ${boxLabel}`}
        className="cash-dialog" onClose={() => { if (!busy) { setError(""); setMovementKind(null); } }}>
        <ErrorBox message={error} />
        <form className="form-stack" onSubmit={record}>
          {admin && <label>Fecha<input type="date" name="day" defaultValue={today()} required /></label>}
          <label>Concepto<input name="detail" placeholder="Ej. Compra de insumos" maxLength={160} required /></label>
          <label>Importe base (Bs)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" pattern="[0-9]{1,7}([.,][0-9]{1,2})?" required /></label>
          <label>Medio de pago<select value={method} onChange={(e) => setTransferMethod(e.target.value)}>
            {paymentMethods.map((item) => <option key={item}>{item}</option>)}
          </select></label>
          {movementKind === "income" && method === "Tarjeta" && <CardCharge base={base} />}
          <div className="modal-actions">
            <button className="button secondary" type="button" disabled={busy} onClick={() => { setError(""); setMovementKind(null); }}>Cancelar</button>
            <button className="button primary" disabled={busy || !base}>{movementKind === "expense" ? "Guardar egreso" : "Guardar ingreso"}</button>
          </div>
        </form>
      </Modal>}
      {voiding && <Modal title="Anular movimiento" className="cash-dialog"
        onClose={() => { if (!busy) { setVoiding(null); setError(""); } }}>
        <div className="form-stack">
          <ErrorBox message={error} />
          <p><strong>{voiding.detail}</strong> · {money(voiding.base_cents)}</p>
          <p className="muted">El movimiento quedará visible como anulado en el historial.</p>
          <div className="modal-actions">
            <button className="button secondary" disabled={busy} onClick={() => { setVoiding(null); setError(""); }}>Cancelar</button>
            <button className="button primary" disabled={busy} onClick={() => void voidEntry(voiding.id)}>Confirmar anulación</button>
          </div>
        </div>
      </Modal>}
    </div>
  </div>;
}
