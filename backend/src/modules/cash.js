import { Router } from "express";
import { localDay, paymentMethods, cardSurcharge } from "../core/charges.js";
import { transaction } from "../core/database.js";
import { audit, choice, date, fail, integer, text } from "../core/validation.js";
import { canSeeSuperadmin } from "./users.js";
import { currentTurn, turnFor } from "./shifts.js";

const ledger = (where) => `WITH ledger AS (
  SELECT 'manual' AS source,id,day,kind,detail,base_cents,surcharge_cents,method,user_id,voided,cash_box,turn_id
  FROM cash_entries
  UNION ALL
  SELECT 'folio',p.id,p.day,'income',CASE WHEN m.id IS NULL THEN 'Hoja #' ELSE 'Consumo Pub · Hoja #' END || f.id || ' · ' || f.title,
    p.amount_cents,p.surcharge_cents,p.method,p.user_id,p.voided,CASE WHEN m.id IS NULL THEN 'petty' ELSE 'pub' END,p.turn_id
  FROM folio_payments p JOIN folios f ON f.id=p.folio_id
  LEFT JOIN pop_movements m ON m.folio_service_id=p.service_id
  WHERE p.group_id IS NULL
  UNION ALL
  SELECT 'stay',leader.id,leader.day,'income','Cobro de hospedaje · Reserva #' || f.reservation_id,
    (SELECT SUM(p.amount_cents) FROM folio_payments p WHERE p.group_id=leader.id),
    leader.surcharge_cents,leader.method,leader.user_id,leader.voided,'petty',leader.turn_id
  FROM folio_payments leader JOIN folios f ON f.id=leader.folio_id
  WHERE leader.group_id=leader.id
  UNION ALL
  SELECT 'refund',r.id,r.day,'expense','Reembolso · ' || r.reason,
    r.amount_cents,0,p.method,r.user_id,0,CASE WHEN m.id IS NULL THEN 'petty' ELSE 'pub' END,r.turn_id
  FROM folio_refunds r JOIN folio_payments p ON p.id=r.payment_id
  LEFT JOIN pop_movements m ON m.folio_service_id=p.service_id
  UNION ALL
  SELECT 'pop',id,day,'income',detail,base_cents,surcharge_cents,method,user_id,0,'pub',turn_id
  FROM pop_movements WHERE kind='sale' AND folio_service_id IS NULL
)
SELECT ledger.source,ledger.id,ledger.day,ledger.kind,ledger.detail,ledger.base_cents,
  ledger.surcharge_cents,ledger.method,ledger.voided,ledger.cash_box,
  ledger.base_cents AS cash_cents,
  CASE WHEN ledger.method='Efectivo' THEN ledger.base_cents ELSE 0 END AS physical_cents,
  (SELECT a.created_at FROM audit_log a WHERE a.entity_id=ledger.id AND a.entity=
    CASE ledger.source WHEN 'manual' THEN 'cash_entry' WHEN 'pop' THEN 'pop_movement' WHEN 'refund' THEN 'folio_refund'
      ELSE 'folio_payment' END ORDER BY a.id LIMIT 1) AS recorded_at,
  CASE WHEN u.role='superadmin' AND NOT ? THEN 'Atatau' ELSE COALESCE(t.user_name,u.name) END AS author
FROM ledger JOIN users u ON u.id=ledger.user_id
LEFT JOIN cash_turns t ON t.id=ledger.turn_id
WHERE ledger.cash_box=? AND ${where}
ORDER BY ledger.day DESC,recorded_at DESC,ledger.source,ledger.id DESC`;

const cashBox = (value) => choice(value ?? "petty", ["petty", "pub"], "Caja");

export function cashModule(db, admin) {
  const router = Router();
  const list = db.prepare(ledger("ledger.day>=? AND ledger.day<?"));
  const listTurn = db.prepare(ledger("ledger.turn_id=?"));
  const findEntry = db.prepare("SELECT id,day,kind,detail,base_cents,surcharge_cents,method,voided,cash_box,turn_id FROM cash_entries WHERE id=?");
  function period(req, res, start, end) {
    res.json(list.all(canSeeSuperadmin(req.user), cashBox(req.query.box), start, end));
  }
  router.get("/daily", (req, res) => {
    if (req.user.role === "receptionist") {
      const box = cashBox(req.query.box);
      const turn = currentTurn(db, req.user);
      return res.json(turn?.id ? listTurn.all(0, box, turn.id) : []);
    }
    const day = localDay();
    period(req, res, day, day + "T");
  });
  const turnColumns = `t.id,t.started_at,t.expires_at,
    COALESCE(t.closed_at, CASE WHEN t.expires_at<=? THEN t.expires_at END) AS ended_at,
    CASE WHEN u.role='superadmin' AND NOT ? THEN 'Atatau' ELSE t.user_name END AS author`;
  router.get("/turns", (req, res) => {
    const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER :
      integer(Number(req.query.before), "Turno", 1, Number.MAX_SAFE_INTEGER);
    res.json(db.prepare(`SELECT ${turnColumns},t.window_key FROM cash_turns t JOIN users u ON u.id=t.user_id
      WHERE t.id<? AND (? OR t.user_id=?) AND (
        EXISTS (SELECT 1 FROM cash_entries WHERE turn_id=t.id) OR
        EXISTS (SELECT 1 FROM folio_payments WHERE turn_id=t.id) OR
        EXISTS (SELECT 1 FROM pop_movements WHERE turn_id=t.id AND folio_service_id IS NULL) OR
        EXISTS (SELECT 1 FROM folio_refunds WHERE turn_id=t.id)
      ) ORDER BY t.id DESC LIMIT 50`)
      .all(new Date().toISOString(), canSeeSuperadmin(req.user), before,
        Number(req.user.role !== "receptionist"), req.user.id));
  });
  router.get("/turns/:id", (req, res) => {
    const full = canSeeSuperadmin(req.user);
    const box = cashBox(req.query.box);
    if (req.params.id === "current") {
      const turn = currentTurn(db, req.user);
      return res.json(turn ? {
        id: turn.id, started_at: turn.started_at, expires_at: turn.expires_at,
        ended_at: null, author: turn.user_name, window_key: turn.window_key, refresh_at: turn.refresh_at ?? turn.expires_at,
        entries: turn.id ? listTurn.all(full, box, turn.id) : [],
      } : { id: null, started_at: null, expires_at: null, ended_at: null, author: req.user.name, window_key: null,
        refresh_at: null, entries: [] });
    }
    const id = integer(Number(req.params.id), "Turno", 1, Number.MAX_SAFE_INTEGER);
    const turn = db.prepare(`SELECT ${turnColumns},t.window_key FROM cash_turns t JOIN users u ON u.id=t.user_id
      WHERE t.id=? AND (? OR t.user_id=?)`)
      .get(new Date().toISOString(), full, id, Number(req.user.role !== "receptionist"), req.user.id);
    if (!turn) fail("Turno inexistente.", 404);
    res.json({ ...turn, entries: listTurn.all(full, box, id) });
  });
  router.get("/monthly", admin, (req, res) => {
    const month = req.query.month;
    if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) fail("Elige un mes válido.");
    const start = date(month + "-01");
    period(req, res, start, month + "-32");
  });
  router.post("/", (req, res) => {
    const day = date(req.body.day);
    const kind = choice(req.body.kind, ["income", "expense"], "Movimiento");
    const box = cashBox(req.body.cash_box);
    if (box === "pub" && kind === "income")
      fail("Los ingresos de Caja Pub se registran desde Inventario Pub.", 400);
    if (req.user.role === "receptionist" && (day !== localDay() || kind !== "income"))
      fail("Recepción solo puede registrar ingresos del día.", 403);
    const detail = text(req.body.detail, "Concepto", 160);
    const base = integer(req.body.base_cents, "Importe", 1, 100_000_000);
    const method = choice(req.body.method, paymentMethods, "Medio de pago");
    const surcharge = kind === "income" ? cardSurcharge(base, method) : 0;
    const id = transaction(db, () => {
      const turnId = turnFor(db, req.user);
      const result = db.prepare(`INSERT INTO cash_entries(day,kind,detail,base_cents,surcharge_cents,method,user_id,cash_box,turn_id)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(day, kind, detail, base, surcharge, method, req.user.id, box, turnId);
      const id = Number(result.lastInsertRowid);
      audit(db, req.user, "create", "cash_entry", id, null, findEntry.get(id));
      return id;
    });
    res.status(201).json({ id, cash_cents: base, surcharge_cents: surcharge, collected_cents: base + surcharge });
  });
  router.post("/:id/void", admin, (req, res) => {
    const id = integer(Number(req.params.id), "Movimiento");
    transaction(db, () => {
      const before = findEntry.get(id);
      if (!db.prepare("UPDATE cash_entries SET voided=1 WHERE id=? AND voided=0").run(id).changes)
        fail("Movimiento activo inexistente.", 404);
      audit(db, req.user, "void", "cash_entry", id, before, findEntry.get(id));
    });
    res.json({ ok: true });
  });
  return router;
}
