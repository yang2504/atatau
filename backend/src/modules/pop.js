import { Router } from "express";
import { randomUUID } from "node:crypto";
import { localDay, paymentMethods, cardSurcharge } from "../core/charges.js";
import { transaction } from "../core/database.js";
import { audit, choice, fail, integer, text } from "../core/validation.js";
import { canSeeSuperadmin } from "./users.js";
import { turnFor } from "./shifts.js";

export function popModule(db, admin) {
  const router = Router();
  const find = db.prepare("SELECT * FROM pop_products WHERE id=?");
  const findCategory = db.prepare("SELECT * FROM pop_categories WHERE id=?");
  router.get("/", (req, res) => res.json(db.prepare(`
    SELECT p.*,photo.revision AS photo_revision FROM pop_products p
    LEFT JOIN pop_product_photos photo ON photo.product_id=p.id ORDER BY p.name
  `).all()));
  router.get("/:id/photo", (req, res) => {
    const photo = db.prepare("SELECT jpeg FROM pop_product_photos WHERE product_id=?").get(integer(Number(req.params.id), "Producto"));
    if (!photo) fail("Foto inexistente.", 404);
    res.type("image/jpeg").send(Buffer.from(photo.jpeg));
  });
  router.get("/categories", (req, res) => {
    res.json(db.prepare("SELECT * FROM pop_categories ORDER BY name COLLATE NOCASE,id").all());
  });
  function saveCategory(req, res) {
    const id = req.params.id ? integer(Number(req.params.id), "Categoría") : null;
    const name = text(req.body.name, "Categoría", 60);
    const category = transaction(db, () => {
      const before = id === null ? null : findCategory.get(id);
      if (id !== null && !before) fail("Categoría inexistente.", 404);
      if (db.prepare("SELECT id FROM pop_categories WHERE name=? AND id<>?").get(name, id ?? 0))
        fail("Ya existe una categoría con ese nombre.", 409);
      const saved = id === null
        ? db.prepare("INSERT INTO pop_categories(name) VALUES(?) RETURNING *").get(name)
        : db.prepare("UPDATE pop_categories SET name=? WHERE id=? RETURNING *").get(name, id);
      audit(db, req.user, id === null ? "create" : "update", "pop_category", saved.id, before, saved);
      return saved;
    });
    res.status(id === null ? 201 : 200).json(category);
  }
  router.post("/categories", admin, saveCategory);
  router.patch("/categories/:id", admin, saveCategory);
  router.delete("/categories/:id", admin, (req, res) => {
    const id = integer(Number(req.params.id), "Categoría");
    transaction(db, () => {
      const before = findCategory.get(id);
      if (!before) fail("Categoría inexistente.", 404);
      db.prepare("DELETE FROM pop_categories WHERE id=?").run(id);
      audit(db, req.user, "delete", "pop_category", id, before);
    });
    res.json({ ok: true });
  });
  router.get("/movements", (req, res) => res.json(db.prepare(`
    SELECT m.id,m.product_id,m.day,m.kind,m.quantity,m.detail,m.base_cents,m.surcharge_cents,m.method,
      s.folio_id,f.title AS folio_title,
      CASE WHEN u.role='superadmin' AND NOT ? THEN 'Atatau' ELSE u.name END AS author
    FROM pop_movements m JOIN users u ON u.id=m.user_id LEFT JOIN folio_services s ON s.id=m.folio_service_id
    LEFT JOIN folios f ON f.id=s.folio_id ORDER BY m.id DESC LIMIT 100
  `).all(canSeeSuperadmin(req.user))));
  function save(req, res) {
    const id = req.params.id ? integer(Number(req.params.id), "Producto") : null;
    const name = text(req.body.name, "Producto", 100);
    const price = integer(req.body.price_cents, "Precio unitario", 1, 100_000_000);
    const active = integer(req.body.active ?? 1, "Estado", 0, 1);
    const encoded = req.body.photo;
    let photo;
    if (encoded != null) {
      if (typeof encoded !== "string" || encoded.length > 273068 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
        fail("La foto debe ser un JPEG de hasta 200 KB.");
      photo = Buffer.from(encoded, "base64");
      if (photo.length < 4 || photo.length > 204800 || photo[0] !== 255 || photo[1] !== 216 ||
          photo.at(-2) !== 255 || photo.at(-1) !== 217) fail("La foto debe ser un JPEG de hasta 200 KB.");
    }
    const savedId = transaction(db, () => {
      const previous = id ? find.get(id) : null;
      const reorder = integer(req.body.low_stock ?? previous?.low_stock ?? 3, "Mínimo de stock", 0, 1_000_000);
      if (id && !previous) fail("Producto inexistente.", 404);
      const categoryId = req.body.category_id === undefined ? previous?.category_id ?? null :
        req.body.category_id === null ? null : integer(req.body.category_id, "Categoría");
      if (categoryId !== null && !findCategory.get(categoryId)) fail("Categoría inexistente.", 404);
      if (db.prepare("SELECT id FROM pop_products WHERE name=? AND id<>?").get(name, id ?? 0))
        fail("Ya existe un producto con ese nombre.", 409);
      if (id) db.prepare("UPDATE pop_products SET name=?,price_cents=?,active=?,category_id=?,low_stock=? WHERE id=?")
        .run(name, price, active, categoryId, reorder, id);
      const saved = id ?? Number(db.prepare("INSERT INTO pop_products(name,price_cents,active,category_id,low_stock) VALUES(?,?,?,?,?)")
        .run(name, price, active, categoryId, reorder).lastInsertRowid);
      if (photo) db.prepare(`INSERT INTO pop_product_photos VALUES(?,?,?) ON CONFLICT(product_id)
        DO UPDATE SET jpeg=excluded.jpeg,revision=excluded.revision`).run(saved, photo, randomUUID());
      else if (encoded === null) db.prepare("DELETE FROM pop_product_photos WHERE product_id=?").run(saved);
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
    const folioId = req.body.folio_id == null ? null : integer(req.body.folio_id, "Hoja de consumo");
    if (folioId !== null && !sale) fail("Solo las ventas pueden cargarse a un huésped.");
    const method = sale && folioId === null ? choice(req.body.method, paymentMethods, "Medio de pago") : null;
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
      const day = localDay();
      let serviceId = null;
      if (folioId !== null) {
        if (base > 100_000_000) fail("El consumo supera el importe permitido por cargo.");
        const folio = db.prepare(`SELECT 1 FROM folios f JOIN reservations r ON r.id=f.reservation_id
          LEFT JOIN guests g ON g.id=f.guest_id WHERE f.id=? AND r.status='in_house'
          AND COALESCE(g.joined_on,r.check_in)<=? AND r.check_out>=?`).get(folioId, day, day);
        if (!folio) fail("Elige la hoja de un huésped que esté alojado.", 409);
        serviceId = Number(db.prepare(`INSERT INTO folio_services(folio_id,day,service,detail,total_cents,user_id)
          VALUES(?,?,'Consumo Pub',?,?,?)`).run(folioId, day, detail, base, req.user.id).lastInsertRowid);
        audit(db, req.user, "create", "folio_service", serviceId, null, { folio_id: folioId, day, detail, total_cents: base });
      }
      db.prepare("UPDATE pop_products SET stock=? WHERE id=?").run(stock, productId);
      const turnId = sale && folioId === null ? turnFor(db, req.user) : null;
      const id = Number(db.prepare(`INSERT INTO pop_movements
        (product_id,day,kind,quantity,detail,base_cents,surcharge_cents,method,user_id,turn_id,folio_service_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(productId, day, kind, quantity, detail, base, surcharge, method,
          req.user.id, turnId, serviceId).lastInsertRowid);
      audit(db, req.user, "create", "pop_movement", id, { stock: product.stock }, {
        product_id: productId, kind, quantity, detail, stock, base_cents: base,
        surcharge_cents: surcharge, method, turn_id: turnId, folio_id: folioId, service_id: serviceId,
      });
      return { id, stock, cash_cents: folioId === null ? base : 0, surcharge_cents: surcharge,
        collected_cents: folioId === null ? base + surcharge : 0, folio_id: folioId };
    });
    res.status(201).json(result);
  });
  return router;
}
