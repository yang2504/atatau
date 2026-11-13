import { Router } from "express";
import { transaction } from "../core/database.js";
import { MAX_NIGHTLY_CENTS, nightDates, nightRates, paidNights } from "./lodging.js";
import { localDay } from "../core/charges.js";
import { canSeeSuperadmin } from "./users.js";
import { ensureReservationFolios, recordStayPayment, setNightlyRates } from "./folios.js";
import {
  text,
  integer,
  choice,
  date,
  fail,
  audit,
} from "../core/validation.js";

const addedGuests = (db, id) => db.prepare(`SELECT id,name,joined_on,unit_id,nightly_cents
  FROM guests WHERE reservation_id=? AND joined_on IS NOT NULL ORDER BY id`).all(id);

function occupiedUnit(db) {
  return db.prepare(`SELECT 1 FROM reservations r
    JOIN reservation_occupancy a ON a.reservation_id=r.id WHERE a.unit_id=:unit
    AND r.id<>:id AND r.status<>'cancelled' AND a.starts_on<a.ends_on AND a.starts_on<:end AND a.ends_on>:start
    LIMIT 1`);
}

const movesFor = (db, id) => db.prepare(
  "SELECT day,unit_id FROM reservation_moves WHERE reservation_id=? ORDER BY day,unit_id",
).all(id);

const occupancyFor = (db, id) => db.prepare(
  "SELECT unit_id,starts_on,ends_on FROM reservation_occupancy WHERE reservation_id=? AND starts_on<ends_on ORDER BY starts_on,unit_id",
).all(id);

function validateExtraRates(extras, start, end, base, rates) {
  for (const day of nightDates(start, end)) {
    const total = extras.reduce((sum, guest) => sum + (guest.joined_on <= day ? guest.nightly_cents : 0), rates[day] ?? base ?? 0);
    if (total > MAX_NIGHTLY_CENTS) fail("El total por noche supera el importe permitido.");
  }
}

export function listReservations(db, full = 1) {
  return db
    .prepare(
      `SELECT r.*,p.name AS platform_name,
        COALESCE(creation.actor_name,creator.name) AS created_by_name,
        COALESCE(arrival.actor_name,u.name) AS checked_in_by_name,
        COALESCE(departure.actor_name,closer.name) AS checked_out_by_name,
        creator.role AS creator_role,u.role AS check_in_role,closer.role AS check_out_role,
        (SELECT COALESCE(SUM(p.retained_cents),0) FROM folio_payment_balances p
          JOIN folios f ON f.id=p.folio_id WHERE f.reservation_id=r.id
          AND p.lodging_day IS NOT NULL AND p.voided=0) AS lodging_paid_cents
        FROM reservations r JOIN platforms p ON p.id=r.platform_id
        JOIN users creator ON creator.id=r.created_by
        LEFT JOIN audit_log creation ON creation.id=(
          SELECT id FROM audit_log WHERE entity='reservation' AND entity_id=r.id AND action='create' ORDER BY id LIMIT 1)
        LEFT JOIN users u ON u.id=r.checked_in_by
        LEFT JOIN audit_log arrival ON arrival.id=(
          SELECT id FROM audit_log WHERE entity='reservation' AND entity_id=r.id
            AND action='check_in' AND user_id=r.checked_in_by ORDER BY id LIMIT 1)
        LEFT JOIN audit_log departure ON departure.id=(
          SELECT id FROM audit_log WHERE entity='reservation' AND entity_id=r.id AND action='check_out' ORDER BY id DESC LIMIT 1)
        LEFT JOIN users closer ON closer.id=departure.user_id
        ORDER BY r.check_in,r.id`,
    )
    .all()
    .map(({ creator_role, check_in_role, check_out_role, ...r }) => {
      const rates = nightRates(db, r.id);
      return {
      ...r,
      created_by: !full && creator_role === "superadmin" ? null : r.created_by,
      created_by_name: !full && creator_role === "superadmin" ? "Atatau" : r.created_by_name,
      checked_in_by: !full && check_in_role === "superadmin" ? null : r.checked_in_by,
      checked_in_by_name: !full && check_in_role === "superadmin" ? "Atatau" : r.checked_in_by_name,
      checked_in_at: !full && check_in_role === "superadmin" ? null : r.checked_in_at,
      checked_out_by_name: !full && check_out_role === "superadmin" ? "Atatau" : r.checked_out_by_name,
      night_rates: rates,
      paid_nights: paidNights(db, r.id, r.nightly_cents, rates),
      room_assignments: roomAssignments(db, r.id),
      added_guests: addedGuests(db, r.id),
      moves: movesFor(db, r.id),
      occupancy: occupancyFor(db, r.id),
      unit_ids: db
        .prepare("SELECT unit_id FROM allocations WHERE reservation_id=?")
        .all(r.id)
        .map((a) => a.unit_id),
      guests: db
        .prepare(
          "SELECT id,name FROM guests WHERE reservation_id=? AND joined_on IS NULL ORDER BY id",
        )
        .all(r.id),
      };
    });
}

function roomAssignments(db, id) {
  return db.prepare(`SELECT u.room_id, SUM(a.pax) AS pax, json_group_array(u.id ORDER BY u.id) AS unit_ids
    FROM allocations a JOIN units u ON u.id=a.unit_id
    WHERE a.reservation_id=? AND a.pax IS NOT NULL GROUP BY u.room_id ORDER BY u.room_id`)
    .all(id).map((row) => ({ ...row, unit_ids: JSON.parse(row.unit_ids) }));
}

function reservationSnapshot(db, reservation, rates) {
  const { created_by, checked_in_by, ...fields } = reservation;
  return {
    ...fields,
    units: db.prepare(`SELECT a.unit_id,u.label,room.id AS room_id,room.name AS room_name,a.pax
      FROM allocations a JOIN units u ON u.id=a.unit_id JOIN rooms room ON room.id=u.room_id
      WHERE a.reservation_id=? ORDER BY a.unit_id`).all(fields.id).map(({ pax, ...unit }) =>
        pax === null ? unit : { ...unit, pax }),
    guests: db.prepare("SELECT id,name FROM guests WHERE reservation_id=? AND joined_on IS NULL ORDER BY id").all(fields.id),
    added_guests: addedGuests(db, fields.id),
    moves: movesFor(db, fields.id),
    folios: db.prepare("SELECT id,title FROM folios WHERE reservation_id=? ORDER BY id").all(fields.id),
    night_rates: rates,
  };
}

function addGuest(db, id, body, user) {
  return transaction(db, () => {
    const reservation = db.prepare("SELECT * FROM reservations WHERE id=?").get(id);
    if (!reservation) fail("Reserva inexistente.", 404);
    if (movesFor(db, id).length) fail("La incorporación requiere una reserva sin traslados registrados.", 409);
    if (!["pending", "confirmed", "in_house"].includes(reservation.status) || reservation.check_out <= localDay())
      fail("Solo puedes ampliar los huéspedes de una reserva activa.", 409);
    const day = date(body.joined_on);
    if (day < reservation.check_in || day >= reservation.check_out)
      fail("La incorporación debe estar dentro de las noches de la reserva.");
    const name = text(body.name, "Nombre del huésped", 100);
    const rate = integer(body.nightly_cents, "Tarifa adicional por noche", 0, MAX_NIGHTLY_CENTS);
    const unitId = integer(body.unit_id, "Habitación o cama");
    const unit = db.prepare(`SELECT u.*,r.type,r.active AS room_active FROM units u JOIN rooms r ON r.id=u.room_id
      WHERE u.id=?`).get(unitId);
    if (!unit?.active || !unit.room_active) fail("La habitación o la cama no está habilitada.");
    const original = db.prepare(`SELECT a.unit_id,a.pax FROM allocations a JOIN units u ON u.id=a.unit_id
      WHERE a.reservation_id=? AND u.room_id=?`).all(id, unit.room_id);
    if (!original.length) fail("Selecciona un cuarto que ya pertenezca a esta reserva.");
    const extras = addedGuests(db, id);
    if (body.expected_added !== extras.length) fail("Los huéspedes cambiaron. Vuelve a abrir la reserva.", 409);
    if (body.expected_check_out !== reservation.check_out)
      fail("La fecha de salida cambió. Vuelve a abrir la reserva.", 409);
    const nightRatesByDay = nightRates(db, id);
    const before = reservationSnapshot(db, reservation, nightRatesByDay);
    if (unit.type === "private") {
      if ((original[0].pax ?? reservation.pax) + extras.filter((guest) => guest.unit_id === unitId).length >= unit.capacity)
        fail("La habitación no tiene plazas para otro huésped durante toda su estadía.", 409);
    } else if (original.some((item) => item.unit_id === unitId) || extras.some((guest) => guest.unit_id === unitId) ||
        occupiedUnit(db).get({ unit: unitId, id, end: reservation.check_out, start: day })) {
      fail("La cama está ocupada durante parte de la estadía. Elige otra cama.", 409);
    }
    validateExtraRates([...extras, { joined_on: day, nightly_cents: rate }], day, reservation.check_out, reservation.nightly_cents, nightRatesByDay);
    const result = db.prepare("INSERT INTO guests(reservation_id,name,joined_on,unit_id,nightly_cents) VALUES(?,?,?,?,?)")
      .run(id, name, day, unitId, rate);
    if (reservation.folio_mode === "individual" && (reservation.status !== "pending" ||
      db.prepare("SELECT 1 FROM folios WHERE reservation_id=?").get(id)))
      ensureReservationFolios(db, id, "individual", "", user);
    audit(db, user, "add_guest", "reservation", id, before, reservationSnapshot(db, reservation, nightRatesByDay));
    return { id: Number(result.lastInsertRowid) };
  });
}

function moveReservation(db, id, body, user) {
  return transaction(db, () => {
    const r = db.prepare("SELECT * FROM reservations WHERE id=?").get(id);
    if (!r) fail("Reserva inexistente.", 404);
    const reopening = r.status === "checked_out" && r.check_out === localDay();
    if ((!["pending", "confirmed", "in_house"].includes(r.status) && !reopening) ||
        roomAssignments(db, id).length || addedGuests(db, id).length)
      fail("El traslado se aplica a reservas activas de un solo cuarto, sin incorporaciones.", 409);
    const moves = movesFor(db, id);
    if (body.expected_check_out !== r.check_out || body.expected_last_move !== (moves.at(-1)?.day ?? null))
      fail("La reserva cambió. Vuelve a abrirla.", 409);
    const day = date(body.day);
    const end = date(body.check_out);
    if (day < r.check_in || (moves.length && day <= moves.at(-1).day) || day > r.check_out ||
        day < localDay() || end < r.check_out || end <= day || Date.parse(end) - Date.parse(r.check_in) > 366 * 86400000)
      fail("Elige una fecha de traslado válida y una salida posterior. Conserva las noches ya reservadas.");
    const ids = body.unit_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 30 || new Set(ids).size !== ids.length)
      fail("Selecciona las plazas del cuarto de destino.");
    const find = db.prepare(`SELECT u.*,r.type,r.active AS room_active FROM units u JOIN rooms r ON r.id=u.room_id WHERE u.id=?`);
    const units = ids.map((id) => find.get(integer(id, "Plaza")));
    if (units.some((unit) => !unit?.active || !unit.room_active))
      fail("Una de las plazas ya no está habilitada.");
    const first = units[0];
    if (units.some((unit) => unit.room_id !== first.room_id) ||
        (first.type === "private" ? units.length !== 1 || r.pax > first.capacity : units.length !== r.pax))
      fail("Elige un cuarto con capacidad suficiente o una cama por persona.");
    const previousUnits = occupancyFor(db, id).filter((span) => span.starts_on <= day && span.ends_on >= day &&
      span.ends_on === r.check_out);
    if (!previousUnits.length || find.get(previousUnits[0].unit_id).room_id === first.room_id)
      fail("Selecciona un cuarto distinto al actual.");
    const overlap = occupiedUnit(db);
    if (units.some((unit) => overlap.get({ unit: unit.id, id, end, start: day })))
      fail("El cuarto o una cama de destino está ocupada en esas fechas.", 409);
    const rate = body.nightly_cents == null ? null : integer(body.nightly_cents, "Tarifa por noche", 0, MAX_NIGHTLY_CENTS);
    if (end > r.check_out && rate === null) fail("Indica la tarifa de las noches adicionales.");
    const rates = nightRates(db, id);
    const before = reservationSnapshot(db, r, rates);
    const insert = db.prepare("INSERT INTO reservation_moves(reservation_id,day,unit_id) VALUES(?,?,?)");
    for (const unit of units) insert.run(id, day, unit.id);
    const status = reopening ? "in_house" : r.status;
    db.prepare("UPDATE reservations SET check_out=?,status=? WHERE id=?").run(end, status, id);
    if (rate !== null) setNightlyRates(db, { ...r, check_out: end }, day, end, rate);
    audit(db, user, "move_room", "reservation", id, before,
      reservationSnapshot(db, { ...r, status, check_out: end }, nightRates(db, id)));
    return { id };
  });
}

export function saveReservation(db, body, user, id = null, extension = false) {
  return transaction(db, () => {
    const previous = id
      ? db.prepare("SELECT * FROM reservations WHERE id=?").get(id)
      : null;
    if (id && !previous) fail("Reserva inexistente.", 404);
    const previousRooms = previous ? roomAssignments(db, id) : [];
    const extras = previous ? addedGuests(db, id) : [];
    const moves = previous ? movesFor(db, id) : [];
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
        room_assignments: previousRooms.length ? previousRooms : undefined,
        unit_ids: db.prepare("SELECT unit_id FROM allocations WHERE reservation_id=?")
          .all(id).map((row) => row.unit_id),
      };
    }
    const group = body.room_assignments !== undefined &&
      (!Array.isArray(body.room_assignments) || body.room_assignments.length > 0);
    if (previous && group !== Boolean(previousRooms.length))
      fail("Conserva el tipo de reserva al editar.");
    const guestName = text(body.guest_name, "Huésped", 100),
      pax = integer(body.pax, "PAX", 1, group ? 1000000 : 30);
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
    const before = previous ? reservationSnapshot(db, previous, originalRates) : null;
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
          `SELECT p.lodging_day FROM folio_payment_balances p
        JOIN folios f ON f.id=p.folio_id
        WHERE f.reservation_id=? AND p.lodging_day IS NOT NULL AND p.voided=0 AND p.retained_cents>0`,
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
    const canAdvance = group
      ? !previous && ["pending", "confirmed"].includes(status)
      : previous?.status === "pending" && status === "pending";
    if (advance != null && !canAdvance)
      fail(group ? "Registra nuevos abonos desde la hoja de consumo del grupo."
        : "El adelanto se registra en una reserva pendiente.", 409);
    const breakfast = integer(body.breakfast ?? previous?.breakfast ?? 0, "Desayuno", 0, 1);
    const mode = choice(
      body.folio_mode,
      ["shared", "individual"],
      "Tipo de cuenta",
    );
    if (group && mode !== "shared") fail("La reserva de grupo usa una sola hoja de consumo.");
    const holderInput = body.folio_holder ?? previous?.folio_holder ?? "";
    const holder = group ? guestName : typeof holderInput === "string" && !holderInput.trim()
      ? ""
      : text(holderInput, "Encargado de la cuenta", 100);
    const sharedTitle = holder || `Grupo de ${guestName}`;
    const comments =
      typeof body.comments === "string" ? body.comments.trim() : "";
    if (comments.length > 2000)
      fail("Las observaciones admiten hasta 2000 caracteres.");
    const places = new Map();
    if (group) {
      if (!Array.isArray(body.room_assignments) || body.room_assignments.length < 2)
        fail("Agrega al menos dos habitaciones o dormitorios a la reserva de grupo.");
      for (const item of body.room_assignments) {
        const roomId = integer(item?.room_id, "Habitación");
        const count = integer(item.pax, "Personas por habitación", 1, 30);
        if (!Array.isArray(item.unit_ids) || !item.unit_ids.length || item.unit_ids.length > 30 || places.has(roomId))
          fail("Indica las plazas de cada habitación una sola vez.");
        places.set(roomId, { count, unitIds: item.unit_ids });
      }
      if ([...places.values()].reduce((sum, place) => sum + place.count, 0) !== pax)
        fail("El total de personas debe coincidir con la distribución por habitación.");
    }
    const unitIds = group ? [...places.values()].flatMap((place) => place.unitIds) : body.unit_ids;
    const uniqueUnits = new Set(Array.isArray(unitIds) ? unitIds : []);
    if (
      !Array.isArray(unitIds) ||
      !unitIds.length ||
      (!group && unitIds.length > 30) ||
      uniqueUnits.size !== unitIds.length
    )
      fail("Selecciona las camas o la habitación.");
    const units = unitIds.map((id) =>
      db
        .prepare(
          "SELECT u.*,r.name AS room_name,r.type,r.active AS room_active FROM units u JOIN rooms r ON r.id=u.room_id WHERE u.id=?",
        )
        .get(integer(id, "Cama")),
    );
    let keepHistory = false;
    if (previous && start === previous.check_in && end === previous.check_out && previous.pax === pax &&
        (status === "cancelled" || (end <= localDay() && status === previous.status))) {
      const savedUnits = db.prepare("SELECT unit_id FROM allocations WHERE reservation_id=?").all(id);
      keepHistory = savedUnits.length === uniqueUnits.size && savedUnits.every((unit) => uniqueUnits.has(unit.unit_id));
    }
    if (units.some((u) => !u || (!moves.length && !keepHistory && (!u.active || !u.room_active))))
      fail("La habitación o la cama no está habilitada.");
    if (group) {
      const unitsById = new Map(units.map((unit) => [unit.id, unit]));
      for (const [roomId, { count, unitIds: assigned }] of places) {
        const first = unitsById.get(assigned[0]);
        if (assigned.some((id) => unitsById.get(id).room_id !== roomId))
          fail("Cada cama debe corresponder a su dormitorio.");
        const historical = keepHistory && previousRooms.some((place) => place.room_id === roomId && place.pax === count);
        if (first.type === "dorm" ? assigned.length !== count : assigned.length !== 1 || (!historical && count > first.capacity))
          fail(`Revisa las plazas asignadas en ${first.room_name}. Usa una cama por persona en dormitorios.`);
      }
    } else if (new Set(units.map((u) => u.room_id)).size !== 1) {
      fail("Elige Reserva de grupo para asignar más de una habitación.");
    } else if (
      units[0].type === "dorm" ? pax !== units.length : !moves.length && !keepHistory && pax > units[0].capacity
    )
      fail(
        "Asigna una cama por persona en dormitorios y respeta la capacidad de las privadas.",
      );
    // Half-open intervals: checkout day can be another guest's check-in day.
    if (moves.length) {
      if (start !== previous.check_in || end <= moves.at(-1).day ||
          before.units.length !== uniqueUnits.size || before.units.some((unit) => !uniqueUnits.has(unit.unit_id)))
        fail("Usa Cambiar de habitación para conservar los traslados registrados.", 409);
      if (status !== "cancelled") {
        const overlap = occupiedUnit(db);
        const find = db.prepare(`SELECT u.active,u.capacity,r.active AS room_active,r.type
          FROM units u JOIN rooms r ON r.id=u.room_id WHERE u.id=?`);
        for (const span of occupancyFor(db, id)) {
          const stop = span.ends_on === previous.check_out || span.ends_on > end ? end : span.ends_on;
          if (span.starts_on >= stop) continue;
          if (overlap.get({ unit: span.unit_id, id, end: stop, start: span.starts_on }))
            fail("Una plaza del traslado está ocupada en esas fechas.", 409);
          const unit = find.get(span.unit_id);
          if (stop > localDay() && (!unit.active || !unit.room_active || (unit.type === "private" && unit.capacity < pax)))
            fail("Una plaza del traslado ya no tiene capacidad o está inhabilitada.", 409);
        }
      }
    } else if (status !== "cancelled") {
      const overlap = occupiedUnit(db);
      for (const unit of units)
        if (overlap.get({ unit: unit.id, id: id ?? 0, end, start }))
          fail(
            group ? `${unit.room_name} · ${unit.label} ya está ocupada en esas fechas.`
              : "Hay una reserva que ocupa esas fechas. Elige otra cama o cambia el rango.",
            409,
          );
    }
    if (previous && (previous.pax !== pax || previous.folio_mode !== mode))
      fail(
        "En esta primera versión, PAX y tipo de cuenta quedan fijos al crear la reserva para conservar las hojas. Cancela y crea otra reserva si necesitas cambiarlos.",
      );
    if (extras.length) {
      const sameUnits = before.units.length === uniqueUnits.size && before.units.every((unit) => uniqueUnits.has(unit.unit_id));
      const samePlaces = previousRooms.every((room) => places.get(room.room_id)?.count === room.pax);
      if (!sameUnits || !samePlaces || (!extension && start !== previous.check_in) ||
          extras.some((guest) => guest.joined_on < start || guest.joined_on >= end))
        fail("Conserva la distribución y las fechas de los huéspedes incorporados.", 409);
      if (status !== "cancelled") {
        const overlap = occupiedUnit(db);
        const activeUnit = db.prepare(`SELECT u.capacity FROM units u JOIN rooms r ON r.id=u.room_id
          WHERE u.id=? AND u.active=1 AND r.active=1`);
        const countByUnit = new Map();
        for (const guest of extras)
          if (overlap.get({ unit: guest.unit_id, id, end, start: guest.joined_on }))
            fail(`La plaza de ${guest.name} está ocupada en el nuevo rango.`, 409);
          else countByUnit.set(guest.unit_id, (countByUnit.get(guest.unit_id) ?? 0) + 1);
        if (!keepHistory) {
          for (const [unitId, count] of countByUnit) {
            const capacity = activeUnit.get(unitId)?.capacity ?? 0;
            const assigned = units.find((unit) => unit.id === unitId);
            const originalPax = assigned ? places.get(assigned.room_id)?.count ?? pax : 0;
            if (originalPax + count > capacity)
              fail("Una plaza de los huéspedes incorporados ya no está habilitada o excede la capacidad.", 409);
          }
        }
      }
      validateExtraRates(extras, start, end, nightlyCents, nextRates);
    }
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
          i === 0 && !group
            ? guestName
            : names[i]
              ? text(names[i], "Nombre del huésped", 100)
              : `${group ? "Huésped" : "Acompañante"} ${i + 1}`;
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
      const updateGuest = db.prepare("UPDATE guests SET name=? WHERE id=?");
      if (!group) updateGuest.run(guestName, first.id);
      else if (Array.isArray(body.guest_names)) {
        const guests = db.prepare("SELECT id FROM guests WHERE reservation_id=? AND joined_on IS NULL ORDER BY id").all(id);
        guests.forEach((guest, index) => {
          const name = body.guest_names[index];
          updateGuest.run(name ? text(name, "Nombre del huésped", 100) : `Huésped ${index + 1}`, guest.id);
        });
      }
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
    const allocate = db.prepare("INSERT INTO allocations(reservation_id,unit_id,pax) VALUES(?,?,?)");
    for (const unit of units)
      allocate.run(id, unit.id, group ? (unit.type === "dorm" ? 1 : places.get(unit.room_id).count) : null);
    if (group || ["confirmed", "in_house", "checked_out"].includes(status) || advance != null)
      ensureReservationFolios(db, id, mode, sharedTitle, user);
    if (datesChanged && (extension || Object.keys(originalRates).length)) {
      db.prepare("DELETE FROM reservation_night_rates WHERE reservation_id=?").run(id);
      const insert = db.prepare("INSERT INTO reservation_night_rates(reservation_id,day,nightly_cents) VALUES(?,?,?)");
      for (const [day, rate] of Object.entries(nextRates)) insert.run(id, day, rate);
    }
    const checkingIn = status === "in_house" && previous?.status !== "in_house";
    const checkingOut = status === "checked_out" && previous?.status !== "checked_out";
    if (checkingIn && !previous?.checked_in_by) {
      db.prepare("UPDATE reservations SET checked_in_by=?, checked_in_at=? WHERE id=?")
        .run(user.id, new Date().toISOString(), id);
    }
    const action = !previous ? "create" : extension ? "extend" : checkingIn ? "check_in" :
      status === "cancelled" && previous.status !== status ? "cancel" :
      checkingOut ? "check_out" : "update";
    const after = reservationSnapshot(db, db.prepare("SELECT * FROM reservations WHERE id=?").get(id), nextRates);
    audit(db, user, action, "reservation", id, before, after);
    if (!previous && checkingIn) audit(db, user, "check_in", "reservation", id, null, after);
    if (!previous && checkingOut) audit(db, user, "check_out", "reservation", id, null, after);
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
      WITH stays AS (
        SELECT * FROM reservations WHERE breakfast=1 AND status<>'cancelled' AND check_in<? AND check_out>=?
      ), people AS (
        SELECT g.*, ROW_NUMBER() OVER (PARTITION BY g.reservation_id ORDER BY g.id) AS position
        FROM guests g JOIN stays r ON r.id=g.reservation_id WHERE g.joined_on IS NULL
      ), rooms_for_stay AS (
        SELECT r.id AS reservation_id,u.room_id,COALESCE(SUM(a.pax),r.pax) AS pax
        FROM stays r JOIN reservation_occupancy o ON o.reservation_id=r.id AND o.extra=0
          AND o.starts_on<o.ends_on AND o.starts_on<? AND o.ends_on>=?
        JOIN units u ON u.id=o.unit_id LEFT JOIN allocations a ON a.reservation_id=r.id AND a.unit_id=o.unit_id
        GROUP BY r.id,u.room_id
      ), places AS (
        SELECT *,SUM(pax) OVER (PARTITION BY reservation_id ORDER BY room_id) AS last_position
        FROM rooms_for_stay
      )
      SELECT g.id,g.name,r.id AS reservation_id,r.guest_name AS holder,r.status,room.name AS room_name
      FROM stays r JOIN people g ON g.reservation_id=r.id
      JOIN places p ON p.reservation_id=r.id AND g.position BETWEEN p.last_position-p.pax+1 AND p.last_position
      JOIN rooms room ON room.id=p.room_id
      UNION ALL
      SELECT g.id,g.name,r.id AS reservation_id,r.guest_name AS holder,r.status,room.name AS room_name
      FROM stays r JOIN guests g ON g.reservation_id=r.id JOIN units u ON u.id=g.unit_id
      JOIN rooms room ON room.id=u.room_id WHERE g.joined_on<?
      ORDER BY room_name,reservation_id,g.id
    `).all(day, day, day, day, day);
    res.json(guests);
  });
  router.post("/", (req, res) =>
    res.status(201).json(saveReservation(db, req.body, req.user)),
  );
  router.post("/:id/extend", (req, res) =>
    res.json(saveReservation(db, req.body, req.user, integer(Number(req.params.id), "Reserva"), true)),
  );
  router.post("/:id/guests", (req, res) =>
    res.status(201).json(addGuest(db, integer(Number(req.params.id), "Reserva"), req.body, req.user)),
  );
  router.post("/:id/move", (req, res) =>
    res.json(moveReservation(db, integer(Number(req.params.id), "Reserva"), req.body, req.user)),
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
