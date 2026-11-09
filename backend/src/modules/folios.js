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
      `SELECT p.id,p.lodging_day,p.service_id,p.day,p.amount_cents,p.method,p.voided,p.surcharge_cents,
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

export function folioModule(db) {
  const router = Router();
  router.get("/", (req, res) =>
    res.json(db.prepare(`${folioQuery} ORDER BY f.id DESC`).all()),
  );
  router.get("/:id", (req, res) => {
    const folio = findFolio(db, integer(Number(req.params.id), "Hoja"));
    res.json({ ...folio, entries: entries(db, folio, canSeeSuperadmin(req.user)) });
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
    const day = date(req.body.day);
    const method = choice(req.body.method, paymentMethods, "Medio de pago");
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
      const id = Number(
        db
          .prepare(
            `INSERT INTO folio_payments(folio_id,lodging_day,service_id,day,amount_cents,method,user_id,surcharge_cents)
        VALUES(?,?,?,?,?,?,?,?)`,
          )
          .run(
            folio.id,
            lodgingDay,
            serviceId,
            day,
            amount,
            method,
            req.user.id,
            surcharge,
          ).lastInsertRowid,
      );
      audit(db, req.user, "create", "folio_payment", id);
      return id;
    });
    res.status(201).json({ id, cash_cents: amount, surcharge_cents: surcharge, collected_cents: amount + surcharge });
  });
  router.post("/:id/payments/:paymentId/void", (req, res) => {
    if (req.user.role === "receptionist")
      fail("Solo administración puede anular un abono.", 403);
    const folioId = integer(Number(req.params.id), "Hoja");
    const paymentId = integer(Number(req.params.paymentId), "Abono");
    transaction(db, () => {
      const result = db
        .prepare(
          "UPDATE folio_payments SET voided=1 WHERE id=? AND folio_id=? AND voided=0",
        )
        .run(paymentId, folioId);
      if (!result.changes) fail("Abono activo inexistente.", 404);
      audit(db, req.user, "void", "folio_payment", paymentId);
    });
    res.json({ ok: true });
  });
  return router;
}
