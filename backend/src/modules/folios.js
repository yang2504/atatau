import { Router } from "express";
import { transaction } from "../core/database.js";
import {
  audit,
  choice,
  date,
  fail,
  integer,
  text,
} from "../core/validation.js";
import { lodgingShare, MAX_NIGHTLY_CENTS } from "./lodging.js";
import { paymentMethods, cardSurcharge } from "../core/charges.js";
import { canSeeSuperadmin } from "./users.js";

const folioQuery = `SELECT f.*, r.guest_name,r.pax,r.check_in,r.check_out,r.status,
  r.folio_mode,r.nightly_cents,r.arrival_time,p.name AS platform_name,
  (SELECT COUNT(*) FROM guests g WHERE g.reservation_id=r.id AND g.id<f.guest_id) AS position
  FROM folios f JOIN reservations r ON r.id=f.reservation_id
  JOIN platforms p ON p.id=r.platform_id`;
const MAX_STAY_CENTS = MAX_NIGHTLY_CENTS * 366;

function paymentDetails(body) {
  return { day: date(body.day), method: choice(body.method, paymentMethods, "Medio de pago") };
}

function insertPayment(db, user, folioId, row, { day, method }, amount, surcharge, groupId = null) {
  const result = db.prepare(`INSERT INTO folio_payments
    (folio_id,lodging_day,service_id,day,amount_cents,method,user_id,surcharge_cents,group_id)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(folioId, row.lodging_day, row.service_id, day,
    amount, method, user.id, surcharge, groupId);
  return Number(result.lastInsertRowid);
}

function findFolio(db, id) {
  const folio = db.prepare(`${folioQuery} WHERE f.id=?`).get(id);
  if (!folio) fail("Hoja de consumo inexistente.", 404);
  return folio;
}

function entries(db, folio, full = 0) {
  const rows = db
    .prepare(
      `SELECT s.id AS service_id, NULL AS lodging_day, s.day, s.service,
    s.detail, s.total_cents, CASE WHEN u.role='superadmin' AND NOT ? THEN 'Atatau' ELSE u.name END AS author
    FROM folio_services s JOIN users u ON u.id=s.user_id WHERE s.folio_id=?`,
    )
    .all(full, folio.id);
  if (folio.nightly_cents !== null) {
    const total = lodgingShare(
      folio.nightly_cents,
      folio.pax,
      folio.guest_id === null ? null : folio.position,
    );
    for (
      let time = Date.parse(folio.check_in);
      time < Date.parse(folio.check_out);
      time += 86400000
    ) {
      const day = new Date(time).toISOString().slice(0, 10);
      rows.push({
        service_id: null,
        lodging_day: day,
        day,
        service: "Hospedaje",
        detail: "1 noche",
        total_cents: total,
        author: null,
      });
    }
  }
  const payments = db
    .prepare(
      `SELECT p.id,p.lodging_day,p.service_id,p.day,p.amount_cents,p.method,p.voided,p.surcharge_cents,p.group_id,
        CASE WHEN u.role='superadmin' AND NOT ? THEN 'Atatau' ELSE u.name END AS author
      FROM folio_payments p
    JOIN users u ON u.id=p.user_id WHERE p.folio_id=? ORDER BY p.id`,
    )
    .all(full, folio.id);
  return rows
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((row) => {
      const matching = payments.filter(
        (p) =>
          p.lodging_day === row.lodging_day && p.service_id === row.service_id,
      );
      const paid = matching.reduce(
        (sum, p) => sum + (p.voided ? 0 : p.amount_cents),
        0,
      );
      return {
        ...row,
        payments: matching,
        paid_cents: paid,
        balance_cents: row.total_cents - paid,
      };
    });
}

export function recordStayPayment(db, reservationId, body, user, fullBalance = false) {
  const details = paymentDetails(body);
  const amount = integer(body.amount_cents, "Importe", 1, MAX_STAY_CENTS);
  const folios = db.prepare(`${folioQuery} WHERE f.reservation_id=? ORDER BY f.id`).all(reservationId);
  const nights = folios.flatMap((folio) => entries(db, folio)
    .filter((row) => row.lodging_day && row.balance_cents > 0)
    .map((row) => ({ folioId: folio.id, row })));
  nights.sort((a, b) => a.row.day.localeCompare(b.row.day));
  const balance = nights.reduce((sum, { row }) => sum + row.balance_cents, 0);
  if (fullBalance && amount !== balance)
    fail("El saldo del hospedaje cambió. Revisa la reserva antes de registrar el cobro.", 409);
  if (amount > balance) fail("El abono supera el saldo del hospedaje.", 409);

  let groupId = null;
  let remaining = amount;
  for (const { folioId, row } of nights) {
    if (!remaining) break;
    const applied = Math.min(remaining, row.balance_cents);
    const id = insertPayment(db, user, folioId, row, details, applied,
      groupId === null ? cardSurcharge(amount, details.method) : 0, groupId);
    if (groupId === null) {
      groupId = id;
      db.prepare("UPDATE folio_payments SET group_id=? WHERE id=?").run(id, id);
    }
    remaining -= applied;
  }
  audit(db, user, "create_stay_payment", "folio_payment", groupId);
  return groupId;
}

function stayPayments(db, folioId, full) {
  return db.prepare(`SELECT p.group_id AS id,leader.day,leader.method,leader.voided,
      SUM(p.amount_cents) AS folio_cents,
      (SELECT SUM(amount_cents) FROM folio_payments WHERE group_id=p.group_id) AS amount_cents,
      leader.surcharge_cents,
      CASE WHEN u.role='superadmin' AND NOT ? THEN 'Atatau' ELSE u.name END AS author
    FROM folio_payments p JOIN folio_payments leader ON leader.id=p.group_id
    JOIN users u ON u.id=leader.user_id WHERE p.folio_id=?
    GROUP BY p.group_id ORDER BY leader.day DESC,p.group_id DESC`).all(full, folioId);
}

function activePayment(db, folioId, id, group) {
  const payment = db.prepare(`SELECT * FROM folio_payments WHERE folio_id=? AND voided=0
    AND CASE WHEN ? THEN group_id=? ELSE id=? AND group_id IS NULL END LIMIT 1`)
    .get(folioId, group ? 1 : 0, id, id);
  if (!payment) fail("Abono activo inexistente.", 404);
  return payment;
}

export function folioModule(db) {
  const router = Router();
  router.get("/", (req, res) =>
    res.json(db.prepare(`${folioQuery} ORDER BY f.id DESC`).all()),
  );
  router.get("/:id", (req, res) => {
    const folio = findFolio(db, integer(Number(req.params.id), "Hoja"));
    const full = canSeeSuperadmin(req.user);
    const rows = entries(db, folio, full).map((row) => ({
      ...row,
      stay_paid_cents: row.payments.reduce((sum, payment) =>
        payment.group_id !== null && !payment.voided ? sum + payment.amount_cents : sum, 0),
      payments: row.payments.filter((payment) => payment.group_id === null),
    }));
    res.json({ ...folio, entries: rows, stay_payments: stayPayments(db, folio.id, full) });
  });
  router.post("/:id/services", (req, res) => {
    const folio = findFolio(db, integer(Number(req.params.id), "Hoja"));
    if (folio.status === "cancelled") fail("La reserva está cancelada.", 409);
    const day = date(req.body.day);
    const service = text(req.body.service, "Servicio", 80);
    const detail = text(req.body.detail, "Detalle", 500);
    const total = integer(req.body.total_cents, "Total", 1, MAX_NIGHTLY_CENTS);
    const id = transaction(db, () => {
      const id = Number(
        db
          .prepare(
            `INSERT INTO folio_services(folio_id,day,service,detail,total_cents,user_id)
        VALUES(?,?,?,?,?,?)`,
          )
          .run(folio.id, day, service, detail, total, req.user.id)
          .lastInsertRowid,
      );
      audit(db, req.user, "create", "folio_service", id);
      return id;
    });
    res.status(201).json({ id });
  });
  router.post("/:id/payments", (req, res) => {
    const folioId = integer(Number(req.params.id), "Hoja");
    const serviceId =
      req.body.service_id == null
        ? null
        : integer(req.body.service_id, "Servicio");
    const lodgingDay =
      req.body.lodging_day == null ? null : date(req.body.lodging_day);
    if ((serviceId === null) === (lodgingDay === null))
      fail("Selecciona un solo cargo.");
    const amount = integer(
      req.body.amount_cents,
      "Abono",
      1,
      MAX_NIGHTLY_CENTS,
    );
    const details = paymentDetails(req.body);
    const { method } = details;
    const surcharge = cardSurcharge(amount, method);
    const id = transaction(db, () => {
      const folio = findFolio(db, folioId);
      if (folio.status === "cancelled") fail("La reserva está cancelada.", 409);
      const row = entries(db, folio).find(
        (row) => row.service_id === serviceId && row.lodging_day === lodgingDay,
      );
      if (!row) fail("Cargo inexistente.", 404);
      if (amount > row.balance_cents)
        fail("El abono supera el saldo del cargo.", 409);
      const id = insertPayment(db, req.user, folio.id, row, details, amount, surcharge);
      audit(db, req.user, "create", "folio_payment", id);
      return id;
    });
    res.status(201).json({ id, cash_cents: amount, surcharge_cents: surcharge, collected_cents: amount + surcharge });
  });
  function voidPayment(req, res, group) {
    if (req.user.role === "receptionist")
      fail("Solo administración puede anular un abono.", 403);
    const folioId = integer(Number(req.params.id), "Hoja");
    const paymentId = integer(Number(req.params.paymentId), "Abono");
    transaction(db, () => {
      activePayment(db, folioId, paymentId, group);
      db.prepare(group
        ? "UPDATE folio_payments SET voided=1 WHERE group_id=?"
        : "UPDATE folio_payments SET voided=1 WHERE id=?").run(paymentId);
      audit(db, req.user, "void", "folio_payment", paymentId);
    });
    res.json({ ok: true });
  }
  function editPayment(req, res, group) {
    if (req.user.role !== "superadmin")
      fail("Solo el superadministrador puede editar abonos.", 403);
    const folioId = integer(Number(req.params.id), "Hoja");
    const paymentId = integer(Number(req.params.paymentId), "Abono");
    const id = transaction(db, () => {
      const payment = activePayment(db, folioId, paymentId, group);
      const folio = findFolio(db, folioId);
      db.prepare(group
        ? "UPDATE folio_payments SET voided=1 WHERE group_id=?"
        : "UPDATE folio_payments SET voided=1 WHERE id=?").run(paymentId);
      audit(db, req.user, "replace", "folio_payment", paymentId);
      if (group) return recordStayPayment(db, folio.reservation_id, req.body, req.user);
      const details = paymentDetails(req.body);
      const amount = integer(req.body.amount_cents, "Abono", 1, MAX_NIGHTLY_CENTS);
      const row = entries(db, folio).find((row) =>
        row.service_id === payment.service_id && row.lodging_day === payment.lodging_day);
      if (!row || amount > row.balance_cents) fail("El abono supera el saldo del cargo.", 409);
      const replacement = insertPayment(db, req.user, folioId, row, details, amount,
        amount === payment.amount_cents && details.method === payment.method
          ? payment.surcharge_cents
          : cardSurcharge(amount, details.method));
      audit(db, req.user, "create", "folio_payment", replacement);
      return replacement;
    });
    res.json({ id });
  }
  router.post("/:id/payments/:paymentId/void", (req, res) => voidPayment(req, res, false));
  router.post("/:id/stay-payments/:paymentId/void", (req, res) => voidPayment(req, res, true));
  router.patch("/:id/payments/:paymentId", (req, res) => editPayment(req, res, false));
  router.patch("/:id/stay-payments/:paymentId", (req, res) => editPayment(req, res, true));
  return router;
}
