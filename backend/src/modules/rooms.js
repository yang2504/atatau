import { Router } from "express";
import { transaction } from "../core/database.js";
import { text, integer, choice, fail, audit } from "../core/validation.js";
import { MAX_NIGHTLY_CENTS } from "./lodging.js";

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
    if (!db.prepare("SELECT id FROM rooms WHERE id=?").get(id))
      fail("Habitación inexistente.", 404);
    const name = text(req.body.name, "Nombre", 80),
      active = integer(req.body.active, "Estado", 0, 1);
    if (db.prepare("SELECT id FROM rooms WHERE name=? AND id<>?").get(name, id))
      fail("Ya existe una habitación con ese nombre.", 409);
    if (
      !active &&
      db
        .prepare(
          "SELECT 1 FROM allocations a JOIN units u ON u.id=a.unit_id JOIN reservations r ON r.id=a.reservation_id WHERE u.room_id=? AND r.status IN ('pending','confirmed','in_house')",
        )
        .get(id)
    )
      fail(
        "Reubica o cierra las reservas activas antes de inhabilitar la habitación.",
        409,
      );
    transaction(db, () => {
      db.prepare("UPDATE rooms SET name=?,active=? WHERE id=?").run(
        name,
        active,
        id,
      );
      audit(db, req.user, "update", "room", id);
    });
    res.json({ ok: true });
  });
  return router;
}
