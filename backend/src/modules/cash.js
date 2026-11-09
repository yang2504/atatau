import { Router } from "express";
import { localDay, paymentMethods, cardSurcharge } from "../core/charges.js";
import { transaction } from "../core/database.js";
import { audit, choice, date, fail, integer, text } from "../core/validation.js";
import { canSeeSuperadmin } from "./users.js";

const ledger = `WITH ledger AS (
  SELECT 'manual' AS source,id,day,kind,detail,base_cents,surcharge_cents,method,user_id,voided,cash_box
  FROM cash_entries WHERE day>=? AND day<?
  UNION ALL
  SELECT 'folio',p.id,p.day,'income','Hoja #' || f.id || ' · ' || f.title,
    p.amount_cents,p.surcharge_cents,p.method,p.user_id,p.voided,'petty'
  FROM folio_payments p JOIN folios f ON f.id=p.folio_id
  WHERE p.group_id IS NULL AND p.day>=? AND p.day<?
  UNION ALL
  SELECT 'stay',leader.id,leader.day,'income','Cobro de hospedaje · Reserva #' || f.reservation_id,
    SUM(p.amount_cents),leader.surcharge_cents,leader.method,leader.user_id,leader.voided,'petty'
  FROM folio_payments leader JOIN folio_payments p ON p.group_id=leader.id
  JOIN folios f ON f.id=leader.folio_id WHERE leader.day>=? AND leader.day<?
  GROUP BY leader.id
  UNION ALL
  SELECT 'pop',id,day,'income',detail,base_cents,surcharge_cents,method,user_id,0,'pub'
  FROM pop_movements WHERE kind='sale' AND day>=? AND day<?
)
SELECT ledger.source,ledger.id,ledger.day,ledger.kind,ledger.detail,ledger.base_cents,
  ledger.surcharge_cents,ledger.method,ledger.voided,ledger.cash_box,
  ledger.base_cents AS cash_cents,
  CASE WHEN u.role='superadmin' AND NOT ? THEN 'Atatau' ELSE u.name END AS author
FROM ledger JOIN users u ON u.id=ledger.user_id
WHERE ledger.cash_box=?
ORDER BY ledger.day DESC,ledger.source,ledger.id DESC`;

const cashBox = (value) => choice(value ?? "petty", ["petty", "pub"], "Caja");

export function cashModule(db, admin) {
  const router = Router();
  const list = db.prepare(ledger);
  function period(req, res, start, end, incomeOnly = false) {
    const entries = list.all(start, end, start, end, start, end, start, end,
      canSeeSuperadmin(req.user), cashBox(req.query.box));
    res.json(incomeOnly ? entries.filter((entry) => entry.kind === "income") : entries);
  }
  router.get("/daily", (req, res) => {
    const day = localDay();
    period(req, res, day, day + "T", req.user.role === "receptionist");
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
    if (req.user.role === "receptionist" && (day !== localDay() || kind !== "income"))
      fail("Recepción solo puede registrar ingresos del día.", 403);
    const detail = text(req.body.detail, "Concepto", 160);
    const base = integer(req.body.base_cents, "Importe", 1, 100_000_000);
    const method = choice(req.body.method, paymentMethods, "Medio de pago");
    const surcharge = kind === "income" ? cardSurcharge(base, method) : 0;
    const id = transaction(db, () => {
      const result = db.prepare(`INSERT INTO cash_entries(day,kind,detail,base_cents,surcharge_cents,method,user_id,cash_box)
        VALUES(?,?,?,?,?,?,?,?)`).run(day, kind, detail, base, surcharge, method, req.user.id, box);
      const id = Number(result.lastInsertRowid);
      audit(db, req.user, "create", "cash_entry", id);
      return id;
    });
    res.status(201).json({ id, cash_cents: base, surcharge_cents: surcharge, collected_cents: base + surcharge });
  });
  router.post("/:id/void", admin, (req, res) => {
    const id = integer(Number(req.params.id), "Movimiento");
    transaction(db, () => {
      if (!db.prepare("UPDATE cash_entries SET voided=1 WHERE id=? AND voided=0").run(id).changes)
        fail("Movimiento activo inexistente.", 404);
      audit(db, req.user, "void", "cash_entry", id);
    });
    res.json({ ok: true });
  });
  return router;
}
