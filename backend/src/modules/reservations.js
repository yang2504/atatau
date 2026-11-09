import { Router } from "express";
import { transaction } from "../core/database.js";
import { MAX_NIGHTLY_CENTS, nightDates, nightRates, paidNights } from "./lodging.js";
import { localDay } from "../core/charges.js";
import { canSeeSuperadmin } from "./users.js";
import { ensureReservationFolios, recordStayPayment } from "./folios.js";
import {
  text,
  integer,
  choice,
  date,
  fail,
  audit,
} from "../core/validation.js";

export function listReservations(db, full = 1) {
  return db
    .prepare(
      `SELECT r.*,p.name AS platform_name,u.name AS checked_in_by_name,
        creator.role AS creator_role,u.role AS check_in_role,
        (SELECT COALESCE(SUM(p.amount_cents),0) FROM folio_payments p
          JOIN folios f ON f.id=p.folio_id WHERE f.reservation_id=r.id
          AND p.lodging_day IS NOT NULL AND p.voided=0) AS lodging_paid_cents
        FROM reservations r JOIN platforms p ON p.id=r.platform_id
        JOIN users creator ON creator.id=r.created_by
        LEFT JOIN users u ON u.id=r.checked_in_by ORDER BY r.check_in,r.id`,
    )
    .all()
    .map(({ creator_role, check_in_role, ...r }) => {
      const rates = nightRates(db, r.id);
      return {
      ...r,
      created_by: !full && creator_role === "superadmin" ? null : r.created_by,
      checked_in_by: !full && check_in_role === "superadmin" ? null : r.checked_in_by,
      checked_in_by_name: !full && check_in_role === "superadmin" ? null : r.checked_in_by_name,
      checked_in_at: !full && check_in_role === "superadmin" ? null : r.checked_in_at,
      night_rates: rates,
      paid_nights: paidNights(db, r.id, r.nightly_cents, rates),
      unit_ids: db
        .prepare("SELECT unit_id FROM allocations WHERE reservation_id=?")
        .all(r.id)
        .map((a) => a.unit_id),
      guests: db
        .prepare(
          "SELECT id,name FROM guests WHERE reservation_id=? ORDER BY id",
        )
        .all(r.id),
      };
    });
}
export function saveReservation(db, body, user, id = null, extension = false) {
  return transaction(db, () => {
    const previous = id
      ? db.prepare("SELECT * FROM reservations WHERE id=?").get(id)
      : null;
    if (id && !previous) fail("Reserva inexistente.", 404);
    let extensionRate;
    if (extension) {
      if (!["pending", "confirmed", "in_house"].includes(previous.status))
        fail("Solo puedes alargar una reserva activa.", 409);
      if (body.expected_check_in !== previous.check_in || body.expected_check_out !== previous.check_out)
        fail("Las fechas de la reserva cambiaron. Vuelve a abrirla.", 409);
      const checkIn = date(body.check_in);
      const checkOut = date(body.check_out);
      if (checkIn > previous.check_in || checkOut < previous.check_out ||
          (checkIn === previous.check_in && checkOut === previous.check_out))
        fail("Agrega al menos una noche y conserva las fechas originales.");
      extensionRate = integer(body.extension_nightly_cents, "Tarifa de extensión", 0, MAX_NIGHTLY_CENTS);
      body = {
        ...previous, check_in: checkIn, check_out: checkOut,
        unit_ids: db.prepare("SELECT unit_id FROM allocations WHERE reservation_id=?")
          .all(id).map((row) => row.unit_id),
      };
    }
    const guestName = text(body.guest_name, "Huésped", 100),
      pax = integer(body.pax, "PAX", 1, 30);
    const start = date(body.check_in),
      end = date(body.check_out);
    if (end <= start) fail("La salida debe ser posterior a la entrada.");
    const span = Date.parse(end) - Date.parse(start);
    if (span > 366 * 86400000)
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
    const originalRates = previous ? nightRates(db, id) : {};
    let nextRates = originalRates;
    const datesChanged = previous && (start !== previous.check_in || end !== previous.check_out);
    if (datesChanged) {
      const sameLength = span === Date.parse(previous.check_out) - Date.parse(previous.check_in);
      if (!extension && !sameLength && (start < previous.check_in || end > previous.check_out))
        fail("Usa Alargar estadía en el calendario para agregar noches con su propia tarifa.", 409);
      if (extension) {
        nextRates = { ...originalRates };
        for (const day of nightDates(start, end))
          if (day < previous.check_in || day >= previous.check_out) nextRates[day] = extensionRate;
      } else if (sameLength) {
        const shift = Date.parse(start) - Date.parse(previous.check_in);
        nextRates = Object.fromEntries(Object.entries(originalRates).map(([day, rate]) =>
          [new Date(Date.parse(day) + shift).toISOString().slice(0, 10), rate]));
      } else {
        nextRates = Object.fromEntries(Object.entries(originalRates).filter(([day]) => day >= start && day < end));
      }
    }
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
            (nextRates[p.lodging_day] ?? nightlyCents) !== (originalRates[p.lodging_day] ?? previous.nightly_cents) ||
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
    const arrivalPayment = body.check_in_payment;
    if (arrivalPayment != null && (status !== "in_house" ||
        !["pending", "confirmed"].includes(previous?.status)))
      fail("El cobro de la estadía solo se registra al confirmar la llegada.", 409);
    const advance = body.advance_payment;
    if (advance != null && (previous?.status !== "pending" || status !== "pending"))
      fail("El adelanto se registra en una reserva pendiente.", 409);
    const breakfast = integer(body.breakfast ?? previous?.breakfast ?? 0, "Desayuno", 0, 1);
    const mode = choice(
      body.folio_mode,
      ["shared", "individual"],
      "Tipo de cuenta",
    );
    const holderInput = body.folio_holder ?? previous?.folio_holder ?? "";
    const holder = typeof holderInput === "string" && !holderInput.trim()
      ? ""
      : text(holderInput, "Encargado de la cuenta", 100);
    const sharedTitle = holder || `Grupo de ${guestName}`;
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
          "SELECT u.*,r.type,r.active AS room_active FROM units u JOIN rooms r ON r.id=u.room_id WHERE u.id=?",
        )
        .get(integer(id, "Cama")),
    );
    const keepHistory = previous && start === previous.check_in && end === previous.check_out &&
      (status === "cancelled" || (end <= localDay() && status === previous.status)) &&
      db.prepare("SELECT unit_id FROM allocations WHERE reservation_id=?").all(id)
        .filter((unit) => unitIds.includes(unit.unit_id)).length === unitIds.length &&
      previous.pax === pax;
    if (units.some((u) => !u || (!keepHistory && (!u.active || !u.room_active))))
      fail("La habitación o la cama no está habilitada.");
    if (new Set(units.map((u) => u.room_id)).size !== 1)
      fail("Cada reserva debe asignarse a una habitación.");
    if (
      units[0].type === "dorm" ? pax !== units.length : !keepHistory && pax > units[0].capacity
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
            "INSERT INTO reservations(guest_name,pax,check_in,check_out,platform_id,status,folio_mode,comments,created_by,nightly_cents,arrival_time,breakfast,folio_holder) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
            holder,
          ).lastInsertRowid,
      );
      const names = Array.isArray(body.guest_names) ? body.guest_names : [];
      const guestInsert = db.prepare(
        "INSERT INTO guests(reservation_id,name) VALUES(?,?)",
      );
      for (let i = 0; i < pax; i++) {
        const name =
          i === 0
            ? guestName
            : names[i]
              ? text(names[i], "Nombre del acompañante", 100)
              : `Acompañante ${i + 1}`;
        guestInsert.run(id, name);
      }
    } else {
      db.prepare(
        "UPDATE reservations SET guest_name=?,check_in=?,check_out=?,platform_id=?,status=?,comments=?,nightly_cents=?,arrival_time=?,breakfast=?,folio_holder=? WHERE id=?",
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
        holder,
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
          sharedTitle,
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
    if (["confirmed", "in_house", "checked_out"].includes(status) || advance != null)
      ensureReservationFolios(db, id, mode, sharedTitle);
    if (datesChanged && (extension || Object.keys(originalRates).length)) {
      db.prepare("DELETE FROM reservation_night_rates WHERE reservation_id=?").run(id);
      const insert = db.prepare("INSERT INTO reservation_night_rates(reservation_id,day,nightly_cents) VALUES(?,?,?)");
      for (const [day, rate] of Object.entries(nextRates)) insert.run(id, day, rate);
    }
    audit(db, user, extension ? "extend" : previous ? "update" : "create", "reservation", id);
    if (status === "in_house" && previous?.status !== "in_house" && !previous?.checked_in_by) {
      db.prepare("UPDATE reservations SET checked_in_by=?, checked_in_at=? WHERE id=?")
        .run(user.id, new Date().toISOString(), id);
      audit(db, user, "check_in", "reservation", id);
    }
    if (arrivalPayment != null) {
      recordStayPayment(db, id, { ...arrivalPayment, day: localDay() }, user, arrivalPayment.amount_cents);
    }
    if (advance != null) {
      const expected = integer(advance.expected_balance_cents, "Saldo esperado", 1, Number.MAX_SAFE_INTEGER);
      recordStayPayment(db, id, { ...advance, day: localDay() }, user, expected);
    }
    return { id };
  });
}
export function reservationModule(db) {
  const router = Router();
  router.get("/", (req, res) => res.json(listReservations(db, canSeeSuperadmin(req.user))));
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
  router.post("/:id/extend", (req, res) =>
    res.json(saveReservation(db, req.body, req.user, integer(Number(req.params.id), "Reserva"), true)),
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
