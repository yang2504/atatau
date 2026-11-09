import { Router } from "express";
import { transaction } from "../core/database.js";
import { MAX_NIGHTLY_CENTS, paidNights } from "./lodging.js";
import {
  text,
  integer,
  choice,
  date,
  fail,
  audit,
} from "../core/validation.js";

export function listReservations(db) {
  return db
    .prepare(
      `SELECT r.*,p.name AS platform_name,u.name AS checked_in_by_name
        FROM reservations r JOIN platforms p ON p.id=r.platform_id
        LEFT JOIN users u ON u.id=r.checked_in_by ORDER BY r.check_in,r.id`,
    )
    .all()
    .map((r) => ({
      ...r,
      paid_nights: paidNights(db, r.id, r.nightly_cents),
      unit_ids: db
        .prepare("SELECT unit_id FROM allocations WHERE reservation_id=?")
        .all(r.id)
        .map((a) => a.unit_id),
      guests: db
        .prepare(
          "SELECT id,name FROM guests WHERE reservation_id=? ORDER BY id",
        )
        .all(r.id),
    }));
}
export function saveReservation(db, body, user, id = null) {
  return transaction(db, () => {
    const previous = id
      ? db.prepare("SELECT * FROM reservations WHERE id=?").get(id)
      : null;
    if (id && !previous) fail("Reserva inexistente.", 404);
    const guestName = text(body.guest_name, "Huésped", 100),
      pax = integer(body.pax, "PAX", 1, 30);
    const start = date(body.check_in),
      end = date(body.check_out);
    if (end <= start) fail("La salida debe ser posterior a la entrada.");
    if (Date.parse(end) - Date.parse(start) > 366 * 86400000)
      fail("La estadía puede tener hasta 366 noches.");
    const nightlyCents =
      previous &&
      (body.nightly_cents === undefined ||
        (body.nightly_cents === null && previous.nightly_cents === null))
        ? previous.nightly_cents
        : integer(body.nightly_cents, "Tarifa por noche", 0, MAX_NIGHTLY_CENTS);
    const arrivalTime = body.arrival_time ?? previous?.arrival_time ?? "";
    if (
      typeof arrivalTime !== "string" ||
      (arrivalTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime))
    )
      fail("Hora de llegada inválida.");
    if (previous) {
      const paid = db
        .prepare(
          `SELECT p.lodging_day FROM folio_payments p
        JOIN folios f ON f.id=p.folio_id
        WHERE f.reservation_id=? AND p.lodging_day IS NOT NULL AND p.voided=0`,
        )
        .all(id);
      if (
        paid.some(
          (p) =>
            nightlyCents !== previous.nightly_cents ||
            p.lodging_day < start ||
            p.lodging_day >= end,
        )
      )
        fail(
          "Hay abonos de hospedaje. Conserva la tarifa y las noches con abonos, o anula el abono incorrecto en la hoja.",
          409,
        );
    }
    const platformId = integer(body.platform_id, "Plataforma");
    const platform = db
      .prepare("SELECT * FROM platforms WHERE id=?")
      .get(platformId);
    if (!platform || (!platform.active && previous?.platform_id !== platformId))
      fail("Selecciona una plataforma habilitada.");
    const status = choice(
      body.status,
      ["pending", "confirmed", "in_house", "checked_out", "cancelled"],
      "Estado",
    );
    const breakfast = integer(body.breakfast ?? previous?.breakfast ?? 0, "Desayuno", 0, 1);
    const mode = choice(
      body.folio_mode,
      ["shared", "individual"],
      "Tipo de cuenta",
    );
    const comments =
      typeof body.comments === "string" ? body.comments.trim() : "";
    if (comments.length > 2000)
      fail("Las observaciones admiten hasta 2000 caracteres.");
    const unitIds = body.unit_ids;
    if (
      !Array.isArray(unitIds) ||
      !unitIds.length ||
      unitIds.length > 30 ||
      new Set(unitIds).size !== unitIds.length
    )
      fail("Selecciona las camas o la habitación.");
    const units = unitIds.map((id) =>
      db
        .prepare(
          "SELECT u.*,r.type,r.active FROM units u JOIN rooms r ON r.id=u.room_id WHERE u.id=?",
        )
        .get(integer(id, "Cama")),
    );
    if (units.some((u) => !u || !u.active))
      fail("La habitación no está habilitada.");
    if (new Set(units.map((u) => u.room_id)).size !== 1)
      fail("Cada reserva debe asignarse a una habitación.");
    if (
      units[0].type === "dorm" ? pax !== units.length : pax > units[0].capacity
    )
      fail(
        "Asigna una cama por persona en dormitorios y respeta la capacidad de las privadas.",
      );
    // Half-open intervals: checkout day can be another guest's check-in day.
    if (status !== "cancelled") {
      const overlap = db.prepare(
        "SELECT r.guest_name FROM allocations a JOIN reservations r ON r.id=a.reservation_id WHERE a.unit_id=? AND r.id<>? AND r.status<>'cancelled' AND r.check_in<? AND r.check_out>? LIMIT 1",
      );
      for (const unit of units)
        if (overlap.get(unit.id, id ?? 0, end, start))
          fail(
            "Hay una reserva que ocupa esas fechas. Elige otra cama o cambia el rango.",
            409,
          );
    }
    if (previous && (previous.pax !== pax || previous.folio_mode !== mode))
      fail(
        "En esta primera versión, PAX y tipo de cuenta quedan fijos al crear la reserva para conservar las hojas. Cancela y crea otra reserva si necesitas cambiarlos.",
      );
    if (!id) {
      id = Number(
        db
          .prepare(
            "INSERT INTO reservations(guest_name,pax,check_in,check_out,platform_id,status,folio_mode,comments,created_by,nightly_cents,arrival_time,breakfast) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            guestName,
            pax,
            start,
            end,
            platformId,
            status,
            mode,
            comments,
            user.id,
            nightlyCents,
            arrivalTime,
            breakfast,
          ).lastInsertRowid,
      );
      const names = Array.isArray(body.guest_names) ? body.guest_names : [];
      const guestInsert = db.prepare(
        "INSERT INTO guests(reservation_id,name) VALUES(?,?)",
      );
      const folioInsert = db.prepare(
        "INSERT INTO folios(reservation_id,guest_id,title) VALUES(?,?,?)",
      );
      for (let i = 0; i < pax; i++) {
        const name =
          i === 0
            ? guestName
            : names[i]
              ? text(names[i], "Nombre del acompañante", 100)
              : `Acompañante ${i + 1}`;
        const guestId = Number(guestInsert.run(id, name).lastInsertRowid);
        if (mode === "individual") folioInsert.run(id, guestId, name);
      }
      if (mode === "shared") folioInsert.run(id, null, `Grupo de ${guestName}`);
    } else {
      db.prepare(
        "UPDATE reservations SET guest_name=?,check_in=?,check_out=?,platform_id=?,status=?,comments=?,nightly_cents=?,arrival_time=?,breakfast=? WHERE id=?",
      ).run(
        guestName,
        start,
        end,
        platformId,
        status,
        comments,
        nightlyCents,
        arrivalTime,
        breakfast,
        id,
      );
      const first = db
        .prepare(
          "SELECT id FROM guests WHERE reservation_id=? ORDER BY id LIMIT 1",
        )
        .get(id);
      db.prepare("UPDATE guests SET name=? WHERE id=?").run(
        guestName,
        first.id,
      );
      if (mode === "shared")
        db.prepare("UPDATE folios SET title=? WHERE reservation_id=?").run(
          `Grupo de ${guestName}`,
          id,
        );
      else
        db.prepare("UPDATE folios SET title=? WHERE guest_id=?").run(
          guestName,
          first.id,
        );
      db.prepare("DELETE FROM allocations WHERE reservation_id=?").run(id);
    }
    for (const unit of units)
      db.prepare(
        "INSERT INTO allocations(reservation_id,unit_id) VALUES(?,?)",
      ).run(id, unit.id);
    audit(db, user, previous ? "update" : "create", "reservation", id);
    if (status === "in_house" && previous?.status !== "in_house" && !previous?.checked_in_by) {
      db.prepare("UPDATE reservations SET checked_in_by=?, checked_in_at=? WHERE id=?")
        .run(user.id, new Date().toISOString(), id);
      audit(db, user, "check_in", "reservation", id);
    }
    return { id };
  });
}
export function reservationModule(db) {
  const router = Router();
  router.get("/", (req, res) => res.json(listReservations(db)));
  router.get("/breakfast", (req, res) => {
    const day = date(req.query.day);
    // Breakfast is served the morning after each booked night, including checkout.
    const guests = db.prepare(`
      SELECT DISTINCT g.id,g.name,r.id AS reservation_id,r.guest_name AS holder,r.status,
        room.name AS room_name
      FROM reservations r JOIN guests g ON g.reservation_id=r.id
      JOIN allocations a ON a.reservation_id=r.id JOIN units u ON u.id=a.unit_id
      JOIN rooms room ON room.id=u.room_id
      WHERE r.breakfast=1 AND r.status<>'cancelled' AND r.check_in<? AND r.check_out>=?
      ORDER BY room.name,r.id,g.id
    `).all(day, day);
    res.json(guests);
  });
  router.post("/", (req, res) =>
    res.status(201).json(saveReservation(db, req.body, req.user)),
  );
  router.put("/:id", (req, res) =>
    res.json(
      saveReservation(
        db,
        req.body,
        req.user,
        integer(Number(req.params.id), "Reserva"),
      ),
    ),
  );
  return router;
}
