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
import { lodgingShare, MAX_NIGHTLY_CENTS, nightDates, nightRates } from "./lodging.js";
import { paymentMethods, cardSurcharge, localDay } from "../core/charges.js";
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
    (folio_id,lodging_day,service_id,day,amount_cents,method,user_id,surcharge_cents,group_id,turn_id)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(folioId, row.lodging_day, row.service_id, day,
    amount, method, user.id, surcharge, groupId, user.turnId);
  return Number(result.lastInsertRowid);
}

function paymentSnapshot(db, id, group = false) {
  const payment = db.prepare(`SELECT id,folio_id,lodging_day,service_id,day,amount_cents,
    method,voided,surcharge_cents,group_id,turn_id FROM folio_payments WHERE id=?`).get(id);
  if (!group) return payment;
  const { folio_id, lodging_day, service_id, ...receipt } = payment;
  const applications = db.prepare(`SELECT folio_id, SUM(amount_cents) AS amount_cents
    FROM folio_payments WHERE group_id=? GROUP BY folio_id ORDER BY folio_id`).all(id);
  return {
    ...receipt,
    amount_cents: applications.reduce((sum, row) => sum + row.amount_cents, 0),
    applications,
  };
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
  const overrides = nightRates(db, folio.reservation_id);
  for (const day of nightDates(folio.check_in, folio.check_out)) {
    const nightlyCents = overrides[day] ?? folio.nightly_cents;
    if (nightlyCents === null) continue;
    const total = lodgingShare(
      nightlyCents,
      folio.pax,
      folio.guest_id === null ? null : folio.position,
    );
    rows.push({
        service_id: null,
        lodging_day: day,
        day,
        service: "Hospedaje",
        detail: overrides[day] === undefined ? "1 noche" : "Noche de extensión",
        total_cents: total,
        author: null,
    });
  }
  const payments = db
    .prepare(
      `SELECT p.id,p.lodging_day,p.service_id,p.day,p.amount_cents,p.retained_cents,p.method,p.voided,p.surcharge_cents,p.group_id,
        CASE WHEN u.role='superadmin' AND NOT ? THEN 'Atatau' ELSE u.name END AS author
      FROM folio_payment_balances p
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
        (sum, p) => sum + (p.voided ? 0 : p.retained_cents),
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

export function ensureReservationFolios(db, reservationId, mode, sharedTitle, user) {
  if (db.prepare("SELECT 1 FROM folios WHERE reservation_id=? LIMIT 1").get(reservationId)) return;
  if (mode === "shared") {
    db.prepare("INSERT INTO folios(reservation_id,guest_id,title) VALUES(?,NULL,?)")
      .run(reservationId, sharedTitle);
  } else {
    db.prepare(`INSERT INTO folios(reservation_id,guest_id,title)
      SELECT reservation_id,id,name FROM guests WHERE reservation_id=? ORDER BY id`).run(reservationId);
  }
  for (const folio of db.prepare("SELECT * FROM folios WHERE reservation_id=? ORDER BY id").all(reservationId))
    audit(db, user, "create", "folio", folio.id, null, folio);
}

export function recordStayPayment(db, reservationId, body, user, expectedBalance = null) {
  const details = paymentDetails(body);
  const amount = integer(body.amount_cents, "Importe", 1, MAX_STAY_CENTS);
  const folios = db.prepare(`${folioQuery} WHERE f.reservation_id=? ORDER BY f.id`).all(reservationId);
  const nights = folios.flatMap((folio) => entries(db, folio)
    .filter((row) => row.lodging_day && row.balance_cents > 0)
    .map((row) => ({ folioId: folio.id, row })));
  nights.sort((a, b) => a.row.day.localeCompare(b.row.day));
  const balance = nights.reduce((sum, { row }) => sum + row.balance_cents, 0);
  if (expectedBalance !== null && expectedBalance !== balance)
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
  audit(db, user, "create_stay_payment", "folio_payment", groupId, null, paymentSnapshot(db, groupId, true));
  return groupId;
}

function stayPayments(db, folioId, full) {
  return db.prepare(`SELECT p.group_id AS id,leader.day,leader.method,leader.voided,
      SUM(p.amount_cents) AS folio_cents,
      (SELECT SUM(amount_cents) FROM folio_payments WHERE group_id=p.group_id) AS amount_cents,
      (SELECT SUM(retained_cents) FROM folio_payment_balances WHERE group_id=p.group_id) AS retained_cents,
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
  router.get("/", (req, res) => {
    const rows = db.prepare(`
      SELECT listed.*,room.id AS room_id,room.name AS room_name,room.type AS room_type,
        (SELECT json_group_array(DISTINCT substr(s.day,1,7)) FROM folio_services s
          WHERE s.folio_id=listed.id) AS service_months,
        (SELECT json_group_array(DISTINCT substr(movement.day,1,7)) FROM (
          SELECT p.day FROM folio_payments p JOIN folios sibling ON sibling.id=p.folio_id
            WHERE sibling.reservation_id=listed.reservation_id
          UNION ALL
          SELECT r.day FROM folio_refunds r JOIN folio_payments p ON p.id=r.payment_id
            JOIN folios sibling ON sibling.id=p.folio_id WHERE sibling.reservation_id=listed.reservation_id
        ) movement) AS paid_months
      FROM (${folioQuery}) listed
      LEFT JOIN rooms room ON room.id=(
        SELECT u.room_id FROM allocations a JOIN units u ON u.id=a.unit_id
        WHERE a.reservation_id=listed.reservation_id LIMIT 1
      )
      WHERE listed.status<>'pending' OR EXISTS (
        SELECT 1 FROM allocations a WHERE a.reservation_id=listed.reservation_id AND a.pax IS NOT NULL
      ) OR EXISTS (
        SELECT 1 FROM folio_payments p JOIN folios sibling ON sibling.id=p.folio_id
        WHERE sibling.reservation_id=listed.reservation_id
      ) OR EXISTS (
        SELECT 1 FROM folio_services s JOIN folios sibling ON sibling.id=s.folio_id
        WHERE sibling.reservation_id=listed.reservation_id
      )
      ORDER BY listed.check_in DESC,listed.id DESC
    `).all();
    res.json(rows.map((row) => ({
      ...row, paid_months: JSON.parse(row.paid_months), service_months: JSON.parse(row.service_months),
    })));
  });
  router.get("/:id", (req, res) => {
    const folio = findFolio(db, integer(Number(req.params.id), "Hoja"));
    const full = canSeeSuperadmin(req.user);
    const rows = entries(db, folio, full).map((row) => ({
      ...row,
      stay_paid_cents: row.payments.reduce((sum, payment) =>
        payment.group_id !== null && !payment.voided ? sum + payment.retained_cents : sum, 0),
      cashiers: [...new Set(row.payments.filter((payment) => !payment.voided)
        .map((payment) => payment.author))],
      payments: row.payments.filter((payment) => payment.group_id === null),
    }));
    const refunds = db.prepare(`SELECT r.id,r.day,r.payment_id,r.amount_cents,r.reason,p.method,
      SUM(a.amount_cents) AS folio_cents,
      CASE WHEN u.role='superadmin' AND NOT ? THEN 'Atatau' ELSE u.name END AS author
      FROM folio_refunds r JOIN folio_refund_allocations a ON a.refund_id=r.id
      JOIN folio_payments applied ON applied.id=a.payment_id JOIN folio_payments p ON p.id=r.payment_id
      JOIN users u ON u.id=r.user_id WHERE applied.folio_id=? GROUP BY r.id ORDER BY r.id DESC`).all(full, folio.id);
    res.json({ ...folio, entries: rows, stay_payments: stayPayments(db, folio.id, full), refunds });
  });
  router.post("/:id/stay-payments", (req, res) => {
    const id = transaction(db, () => {
      const folio = findFolio(db, integer(Number(req.params.id), "Hoja"));
      if (folio.status === "cancelled" || !db.prepare(
        "SELECT 1 FROM allocations WHERE reservation_id=? AND pax IS NOT NULL LIMIT 1",
      ).get(folio.reservation_id)) fail("El cobro conjunto requiere una reserva de grupo vigente.", 409);
      const expected = integer(req.body.expected_balance_cents, "Saldo esperado", 1, MAX_STAY_CENTS);
      return recordStayPayment(db, folio.reservation_id, req.body, req.user, expected);
    });
    res.status(201).json({ id });
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
      audit(db, req.user, "create", "folio_service", id, null, {
        folio_id: folio.id, day, service, detail, total_cents: total,
      });
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
      audit(db, req.user, "create", "folio_payment", id, null, paymentSnapshot(db, id));
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
      checkRefunds(paymentId);
      const before = paymentSnapshot(db, paymentId, group);
      db.prepare(group
        ? "UPDATE folio_payments SET voided=1 WHERE group_id=?"
        : "UPDATE folio_payments SET voided=1 WHERE id=?").run(paymentId);
      audit(db, req.user, "void", "folio_payment", paymentId, before, paymentSnapshot(db, paymentId, group));
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
      checkRefunds(paymentId);
      const folio = findFolio(db, folioId);
      const before = paymentSnapshot(db, paymentId, group);
      db.prepare(group
        ? "UPDATE folio_payments SET voided=1 WHERE group_id=?"
        : "UPDATE folio_payments SET voided=1 WHERE id=?").run(paymentId);
      if (group) {
        const replacement = recordStayPayment(db, folio.reservation_id, req.body, req.user);
        audit(db, req.user, "replace", "folio_payment", paymentId, before, paymentSnapshot(db, replacement, true));
        return replacement;
      }
      const details = paymentDetails(req.body);
      const amount = integer(req.body.amount_cents, "Abono", 1, MAX_NIGHTLY_CENTS);
      const row = entries(db, folio).find((row) =>
        row.service_id === payment.service_id && row.lodging_day === payment.lodging_day);
      if (!row || amount > row.balance_cents) fail("El abono supera el saldo del cargo.", 409);
      const replacement = insertPayment(db, req.user, folioId, row, details, amount,
        amount === payment.amount_cents && details.method === payment.method
          ? payment.surcharge_cents
          : cardSurcharge(amount, details.method));
      const after = paymentSnapshot(db, replacement);
      audit(db, req.user, "create", "folio_payment", replacement, null, after);
      audit(db, req.user, "replace", "folio_payment", paymentId, before, after);
      return replacement;
    });
    res.json({ id });
  }
  function checkRefunds(paymentId) {
    if (db.prepare("SELECT 1 FROM folio_refunds WHERE payment_id=? LIMIT 1").get(paymentId))
      fail("El cobro ya tiene reembolsos registrados.", 409);
  }
  function refundPayment(req, res, group) {
    const folioId = integer(Number(req.params.id), "Hoja");
    const paymentId = integer(Number(req.params.paymentId), "Abono");
    const amount = integer(req.body.amount_cents, "Reembolso", 1, MAX_STAY_CENTS);
    const reason = text(req.body.reason, "Motivo", 160);
    const id = transaction(db, () => {
      activePayment(db, folioId, paymentId, group);
      const payments = db.prepare(`SELECT id,retained_cents FROM folio_payment_balances
        WHERE ${group ? "group_id" : "id"}=? AND voided=0 AND retained_cents>0 ORDER BY id DESC`).all(paymentId);
      const available = payments.reduce((sum, item) => sum + item.retained_cents, 0);
      if (amount > available) fail("El reembolso supera lo que queda del cobro.", 409);
      const day = localDay();
      const refundId = Number(db.prepare(`INSERT INTO folio_refunds(payment_id,user_id,turn_id,day,amount_cents,reason)
        VALUES(?,?,?,?,?,?)`).run(paymentId, req.user.id, req.user.turnId, day, amount, reason).lastInsertRowid);
      const insert = db.prepare("INSERT INTO folio_refund_allocations(refund_id,payment_id,amount_cents) VALUES(?,?,?)");
      let remaining = amount;
      for (const item of payments) {
        const applied = Math.min(remaining, item.retained_cents);
        insert.run(refundId, item.id, applied);
        remaining -= applied;
        if (!remaining) break;
      }
      audit(db, req.user, "refund", "folio_refund", refundId, null,
        { payment_id: paymentId, amount_cents: amount, reason, day });
      return refundId;
    });
    res.status(201).json({ id });
  }
  router.post("/:id/payments/:paymentId/void", (req, res) => voidPayment(req, res, false));
  router.post("/:id/stay-payments/:paymentId/void", (req, res) => voidPayment(req, res, true));
  router.patch("/:id/payments/:paymentId", (req, res) => editPayment(req, res, false));
  router.patch("/:id/stay-payments/:paymentId", (req, res) => editPayment(req, res, true));
  router.post("/:id/payments/:paymentId/refunds", (req, res) => refundPayment(req, res, false));
  router.post("/:id/stay-payments/:paymentId/refunds", (req, res) => refundPayment(req, res, true));
  return router;
}
