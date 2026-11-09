import { Router } from "express";
import { text, integer, fail, audit } from "../core/validation.js";
import { transaction } from "../core/database.js";
export function platformModule(db, admin) {
  const router = Router();
  router.get("/", (req, res) =>
    res.json(db.prepare("SELECT * FROM platforms ORDER BY id").all()),
  );
  router.post("/", admin, (req, res) => {
    const name = text(req.body.name, "Plataforma", 80);
    if (db.prepare("SELECT id FROM platforms WHERE name=?").get(name))
      fail("Esa plataforma ya existe.", 409);
    const id = transaction(db, () => {
      const id = Number(
        db.prepare("INSERT INTO platforms(name) VALUES(?)").run(name)
          .lastInsertRowid,
      );
      audit(db, req.user, "create", "platform", id);
      return id;
    });
    res.status(201).json({ id });
  });
  router.patch("/:id", admin, (req, res) => {
    const id = integer(Number(req.params.id), "Plataforma"),
      active = integer(req.body.active, "Estado", 0, 1);
    if (id === 1) fail("La entrada directa debe permanecer disponible.");
    if (!db.prepare("SELECT id FROM platforms WHERE id=?").get(id))
      fail("Plataforma inexistente.", 404);
    transaction(db, () => {
      db.prepare("UPDATE platforms SET active=? WHERE id=?").run(active, id);
      audit(db, req.user, "update", "platform", id);
    });
    res.json({ ok: true });
  });
  return router;
}
