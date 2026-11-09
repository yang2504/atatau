import { Router } from "express";
import { text, integer, choice, fail, audit } from "../core/validation.js";
import { transaction } from "../core/database.js";
export function noteModule(db) {
  const router = Router();
  router.get("/", (req, res) =>
    res.json(
      db
        .prepare(
          `SELECT n.*,u.name AS author,u.chat_color,r.name AS room_name,v.guest_name,
          substr(parent.body,1,120) AS reply_preview, sender.name AS reply_author
          FROM notes n JOIN users u ON u.id=n.created_by
          LEFT JOIN rooms r ON r.id=n.room_id LEFT JOIN reservations v ON v.id=n.reservation_id
          LEFT JOIN notes parent ON parent.id=n.reply_to LEFT JOIN users sender ON sender.id=parent.created_by
          ORDER BY n.resolved,n.id DESC`,
        )
        .all(),
    ),
  );
  router.post("/", (req, res) => {
    const body = text(req.body.body, "Novedad", 3000),
      category = choice(
        req.body.category,
        ["handover", "maintenance", "purchase", "guest"],
        "Categoría",
      );
    const room =
      req.body.room_id == null ? null : integer(req.body.room_id, "Habitación");
    const reservation =
      req.body.reservation_id == null
        ? null
        : integer(req.body.reservation_id, "Reserva");
    const amount =
      req.body.amount_cents == null
        ? null
        : integer(req.body.amount_cents, "Gasto", 0, 100000000);
    const reply = req.body.reply_to == null ? null : integer(req.body.reply_to, "Mensaje");
    if (reply && !db.prepare("SELECT id FROM notes WHERE id=?").get(reply))
      fail("El mensaje al que respondes no existe.", 404);
    if (room && !db.prepare("SELECT id FROM rooms WHERE id=?").get(room))
      fail("Habitación inexistente.");
    if (
      reservation &&
      !db.prepare("SELECT id FROM reservations WHERE id=?").get(reservation)
    )
      fail("Reserva inexistente.");
    const id = transaction(db, () => {
      const id = Number(
        db
          .prepare(
            "INSERT INTO notes(body,category,room_id,reservation_id,amount_cents,created_by,reply_to) VALUES(?,?,?,?,?,?,?)",
          )
          .run(body, category, room, reservation, amount, req.user.id, reply)
          .lastInsertRowid,
      );
      audit(db, req.user, "create", "note", id);
      return id;
    });
    res.status(201).json({ id });
  });
  router.patch("/:id", (req, res) => {
    const id = integer(Number(req.params.id), "Novedad"),
      resolved = integer(req.body.resolved, "Estado", 0, 1);
    if (!db.prepare("SELECT id FROM notes WHERE id=?").get(id))
      fail("Novedad inexistente.", 404);
    transaction(db, () => {
      db.prepare("UPDATE notes SET resolved=? WHERE id=?").run(resolved, id);
      audit(db, req.user, "update", "note", id);
    });
    res.json({ ok: true });
  });
  return router;
}
