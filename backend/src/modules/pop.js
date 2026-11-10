import { Router } from "express";
import { localDay, paymentMethods, cardSurcharge } from "../core/charges.js";
import { transaction } from "../core/database.js";
import { audit, choice, fail, integer, text } from "../core/validation.js";
import { canSeeSuperadmin } from "./users.js";

export function popModule(db, admin) {
  const router = Router();
  const find = db.prepare("SELECT * FROM pop_products WHERE id=?");
  router.get("/", (req, res) => res.json(db.prepare("SELECT * FROM pop_products ORDER BY name").all()));
  router.get("/movements", (req, res) => res.json(db.prepare(`
    SELECT m.id,m.product_id,m.day,m.kind,m.quantity,m.detail,m.base_cents,m.surcharge_cents,m.method,
      CASE WHEN u.role='superadmin' AND NOT ? THEN 'Atatau' ELSE u.name END AS author
    FROM pop_movements m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 100
  `).all(canSeeSuperadmin(req.user))));
  function save(req, res) {
    const id = req.params.id ? integer(Number(req.params.id), "Producto") : null;
    const name = text(req.body.name, "Producto", 100);
    const price = integer(req.body.price_cents, "Precio unitario", 1, 100_000_000);
    const active = integer(req.body.active ?? 1, "Estado", 0, 1);
    const savedId = transaction(db, () => {
      if (id && !find.get(id)) fail("Producto inexistente.", 404);
      if (db.prepare("SELECT id FROM pop_products WHERE name=? AND id<>?").get(name, id ?? 0))
        fail("Ya existe un producto con ese nombre.", 409);
      if (id) db.prepare("UPDATE pop_products SET name=?,price_cents=?,active=? WHERE id=?").run(name, price, active, id);
      const saved = id ?? Number(db.prepare("INSERT INTO pop_products(name,price_cents,active) VALUES(?,?,?)").run(name, price, active).lastInsertRowid);
      audit(db, req.user, id ? "update" : "create", "pop_product", saved);
      return saved;
    });
    res.status(id ? 200 : 201).json({ id: savedId });
  }
  router.post("/", admin, save);
  router.patch("/:id", admin, save);
  router.post("/:id/movements", (req, res) => {
    const productId = integer(Number(req.params.id), "Producto");
    const quantity = integer(req.body.quantity, "Cantidad");
    const kind = choice(req.body.kind, ["in", "out", "sale"], "Movimiento");
    const sale = kind === "sale";
    if (!sale && req.user.role === "receptionist") fail("Solo administración puede ajustar el stock.", 403);
    const method = sale ? choice(req.body.method, paymentMethods, "Medio de pago") : null;
    const result = transaction(db, () => {
      const product = find.get(productId);
      if (!product) fail("Producto inexistente.", 404);
      if (!product.active && kind !== "out") fail("El producto está inactivo.", 409);
      const stock = product.stock + (kind === "in" ? quantity : -quantity);
      if (stock < 0 || stock > 1_000_000) fail("La cantidad excede el stock disponible o su límite.", 409);
      const base = sale ? product.price_cents * quantity : 0;
      if (sale && req.body.base_cents !== base)
        fail("El precio cambió. Actualiza el producto antes de cobrar.", 409);
      const surcharge = cardSurcharge(base, method);
      const detail = sale ? `${product.name} × ${quantity}` : `${product.name} · ${text(req.body.detail, "Motivo", 160)}`;
      db.prepare("UPDATE pop_products SET stock=? WHERE id=?").run(stock, productId);
      const id = Number(db.prepare(`INSERT INTO pop_movements
        (product_id,day,kind,quantity,detail,base_cents,surcharge_cents,method,user_id,turn_id)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(productId, localDay(), kind, quantity, detail, base, surcharge, method,
          req.user.id, sale ? req.user.turnId : null).lastInsertRowid);
      audit(db, req.user, "create", "pop_movement", id, { stock: product.stock }, {
        product_id: productId, kind, quantity, detail, stock, base_cents: base,
        surcharge_cents: surcharge, method, turn_id: sale ? req.user.turnId : null,
      });
      return { id, stock, cash_cents: base, surcharge_cents: surcharge, collected_cents: base + surcharge };
    });
    res.status(201).json(result);
  });
  return router;
}
