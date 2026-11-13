import { Router } from "express";
import { transaction } from "../core/database.js";
import { text, integer, choice, fail, audit } from "../core/validation.js";
import { MAX_NIGHTLY_CENTS } from "./lodging.js";
import { localDay } from "../core/charges.js";

export function listRooms(db) {
  return db
    .prepare("SELECT * FROM rooms ORDER BY id")
    .all()
    .map((room) => ({
      ...room,
      rates: db
        .prepare(
          "SELECT platform_id,nightly_cents FROM room_rates WHERE room_id=?",
        )
        .all(room.id),
      guest_rates: db.prepare("SELECT pax,breakfast,nightly_cents FROM guest_rates WHERE room_id=?").all(room.id),
      units: db
        .prepare("SELECT * FROM units WHERE room_id=? ORDER BY id")
        .all(room.id),
    }));
}
export function roomModule(db, admin) {
  const router = Router();
  router.get("/", (req, res) => res.json(listRooms(db)));
  router.post("/", admin, (req, res) => {
    const name = text(req.body.name, "Habitación", 80),
      type = choice(req.body.type, ["private", "dorm"], "Tipo"),
      capacity = integer(req.body.capacity, "Capacidad", 1, 30);
    if (db.prepare("SELECT id FROM rooms WHERE name=?").get(name))
      fail("Ya existe una habitación con ese nombre.", 409);
    const id = transaction(db, () => {
      const id = Number(
        db
          .prepare("INSERT INTO rooms(name,type,capacity) VALUES(?,?,?)")
          .run(name, type, capacity).lastInsertRowid,
      );
      const unit = db.prepare(
        "INSERT INTO units(room_id,label,capacity) VALUES(?,?,?)",
      );
      for (let i = 0; i < (type === "dorm" ? capacity : 1); i++)
        unit.run(
          id,
          type === "dorm" ? `Cama ${i + 1}` : "Habitación completa",
          type === "dorm" ? 1 : capacity,
        );
      audit(db, req.user, "create", "room", id);
      return id;
    });
    res.status(201).json({ id });
  });
  router.put("/:id/rates/:platformId", admin, (req, res) => {
    const roomId = integer(Number(req.params.id), "Habitación");
    const platformId = integer(Number(req.params.platformId), "Canal");
    if (
      !db.prepare("SELECT id FROM rooms WHERE id=?").get(roomId) ||
      !db.prepare("SELECT id FROM platforms WHERE id=?").get(platformId)
    )
      fail("Habitación o canal inexistente.", 404);
    transaction(db, () => {
      if (req.body.nightly_cents === null) {
        db.prepare(
          "DELETE FROM room_rates WHERE room_id=? AND platform_id=?",
        ).run(roomId, platformId);
      } else {
        const rate = integer(
          req.body.nightly_cents,
          "Tarifa",
          0,
          MAX_NIGHTLY_CENTS,
        );
        db.prepare(
          `INSERT INTO room_rates(room_id,platform_id,nightly_cents) VALUES(?,?,?)
          ON CONFLICT(room_id,platform_id) DO UPDATE SET nightly_cents=excluded.nightly_cents`,
        ).run(roomId, platformId, rate);
      }
      audit(db, req.user, "update_rate", "room", roomId);
    });
    res.json({ ok: true });
  });
  router.put("/:id/guest-rates", admin, (req, res) => {
    const id = integer(Number(req.params.id), "Habitación");
    const room = db.prepare("SELECT capacity FROM rooms WHERE id=?").get(id);
    if (!room) fail("Habitación inexistente.", 404);
    const pax = integer(req.body.pax, "PAX", 1, room.capacity);
    const breakfast = integer(req.body.breakfast, "Desayuno", 0, 1);
    transaction(db, () => {
      if (req.body.nightly_cents === null) {
        db.prepare("DELETE FROM guest_rates WHERE room_id=? AND pax=? AND breakfast=?").run(id, pax, breakfast);
      } else {
        const amount = integer(req.body.nightly_cents, "Tarifa", 0, MAX_NIGHTLY_CENTS);
        db.prepare(`INSERT INTO guest_rates(room_id,pax,breakfast,nightly_cents) VALUES(?,?,?,?)
          ON CONFLICT(room_id,pax,breakfast) DO UPDATE SET nightly_cents=excluded.nightly_cents`)
          .run(id, pax, breakfast, amount);
      }
      audit(db, req.user, "update_guest_rate", "room", id);
    });
    res.json({ ok: true });
  });
  router.patch("/:id", admin, (req, res) => {
    const id = integer(Number(req.params.id), "Habitación");
    const room = db.prepare("SELECT * FROM rooms WHERE id=?").get(id);
    if (!room)
      fail("Habitación inexistente.", 404);
    const name = text(req.body.name ?? room.name, "Nombre", 80),
      active = integer(req.body.active ?? room.active, "Estado", 0, 1),
      capacity = integer(req.body.capacity ?? room.capacity, "Capacidad", 1, 30);
    if (db.prepare("SELECT id FROM rooms WHERE name=? AND id<>?").get(name, id))
      fail("Ya existe una habitación con ese nombre.", 409);
    if (
      !active &&
      db
        .prepare(
          `SELECT 1 FROM reservation_occupancy a JOIN units u ON u.id=a.unit_id JOIN reservations r ON r.id=a.reservation_id
          WHERE u.room_id=? AND a.starts_on<a.ends_on AND r.status IN ('pending','confirmed','in_house') AND
            (a.ends_on>? OR NOT EXISTS (SELECT 1 FROM reservation_moves m WHERE m.reservation_id=r.id))`,
        )
        .get(id, localDay())
    )
      fail(
        "Reubica o cierra las reservas activas antes de inhabilitar la habitación.",
        409,
      );
    transaction(db, () => {
      const difference = capacity - room.capacity;
      if (difference !== 0) {
        const used = db.prepare(`SELECT DISTINCT a.unit_id,COALESCE(a.pax,r.pax) +
          (SELECT COUNT(*) FROM guests g WHERE g.reservation_id=r.id AND g.unit_id=a.unit_id) AS pax FROM allocations a
          JOIN units u ON u.id=a.unit_id JOIN reservations r ON r.id=a.reservation_id
          WHERE u.room_id=:room AND r.status<>'cancelled' AND EXISTS (
            SELECT 1 FROM reservation_occupancy o WHERE o.reservation_id=r.id AND o.unit_id=u.id
              AND o.extra=0 AND o.starts_on<o.ends_on AND o.ends_on>:day)
          UNION ALL SELECT u.id,r.pax FROM reservation_occupancy o JOIN units u ON u.id=o.unit_id
          JOIN reservations r ON r.id=o.reservation_id
          WHERE u.room_id=:room AND r.status<>'cancelled' AND o.extra=0 AND o.ends_on>:day AND o.starts_on<o.ends_on
            AND EXISTS (SELECT 1 FROM reservation_moves m WHERE m.reservation_id=r.id AND m.day=o.starts_on AND m.unit_id=u.id)
          UNION ALL SELECT u.id,1 FROM guests g JOIN units u ON u.id=g.unit_id
          JOIN reservations r ON r.id=g.reservation_id
          WHERE u.room_id=:room AND r.status<>'cancelled' AND r.check_out>:day`).all({ room: id, day: localDay() });
        if (room.type === "private") {
          if (used.some((row) => row.pax > capacity))
            fail("La nueva capacidad es menor que la de una reserva actual o futura.", 409);
          db.prepare("UPDATE units SET capacity=? WHERE room_id=?").run(capacity, id);
        } else {
          const units = db.prepare("SELECT id,active FROM units WHERE room_id=? ORDER BY id").all(id);
          const setActive = db.prepare("UPDATE units SET active=? WHERE id=?");
          if (difference < 0) {
            const reserved = new Set(used.map((row) => row.unit_id));
            const retire = units.filter((unit) => unit.active && !reserved.has(unit.id)).slice(difference);
            if (retire.length !== -difference)
              fail("No hay suficientes camas libres de reservas actuales o futuras para reducir la capacidad.", 409);
            for (const unit of retire) setActive.run(0, unit.id);
          } else {
            const restored = units.filter((unit) => !unit.active).slice(0, difference);
            for (const unit of restored) setActive.run(1, unit.id);
            const create = db.prepare("INSERT INTO units(room_id,label,capacity) VALUES(?,?,1)");
            for (let i = 1; i <= difference - restored.length; i++)
              create.run(id, `Cama ${units.length + i}`);
          }
        }
      }
      db.prepare("UPDATE rooms SET name=?,active=?,capacity=? WHERE id=?").run(name, active, capacity, id);
      audit(db, req.user, "update", "room", id);
    });
    res.json({ ok: true });
  });
  return router;
}
