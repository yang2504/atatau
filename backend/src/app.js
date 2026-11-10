import express from "express";
import { fileURLToPath } from "node:url";
import { canSeeSuperadmin, userModule } from "./modules/users.js";
import { roomModule } from "./modules/rooms.js";
import { reservationModule } from "./modules/reservations.js";
import { platformModule } from "./modules/platforms.js";
import { noteModule } from "./modules/notes.js";
import { folioModule } from "./modules/folios.js";
import { cashModule } from "./modules/cash.js";
import { popModule } from "./modules/pop.js";
import { bcbRateHandler } from "./modules/bcb.js";
import { audit, integer } from "./core/validation.js";
import { transaction } from "./core/database.js";

export function createApp(db) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    const hosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
    try {
      if (!hosts.has(new URL(`http://${req.headers.host}`).hostname))
        return res
          .status(403)
          .json({ error: "Acceso permitido solo desde este equipo." });
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.headers.origin
      ) {
        const origin = new URL(req.headers.origin);
        if (
          origin.protocol !== "http:" ||
          !hosts.has(origin.hostname) ||
          !["3001", "5173"].includes(origin.port)
        )
          return res.status(403).json({ error: "Origen no permitido." });
      }
    } catch {
      return res.status(403).json({ error: "Origen no permitido." });
    }
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    )
      return res.status(400).json({ error: "Envía un objeto JSON válido." });
    next();
  });
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  const users = userModule(db);
  app.use("/api/auth", users.router);
  app.use("/api", users.requireUser);
  app.get("/api/bcb/usd", bcbRateHandler(db));
  const getRate = db.prepare("SELECT scaled_rate FROM lodging_exchange_rate WHERE id=1");
  app.get("/api/lodging-exchange-rate", (req, res) => res.json(getRate.get() ?? { scaled_rate: null }));
  app.put("/api/lodging-exchange-rate", users.admin, (req, res) => {
    const scaled_rate = integer(req.body.scaled_rate, "Tipo de cambio", 1, 10_000_000);
    transaction(db, () => {
      const before = getRate.get() ?? null;
      db.prepare(`INSERT INTO lodging_exchange_rate(id,scaled_rate) VALUES(1,?)
        ON CONFLICT(id) DO UPDATE SET scaled_rate=excluded.scaled_rate`).run(scaled_rate);
      audit(db, req.user, "update", "lodging_exchange_rate", 1, before, { scaled_rate });
    });
    res.json({ scaled_rate });
  });
  app.get("/api/audit", users.admin, (req, res) => {
    const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER :
      integer(Number(req.query.before), "Registro", 1, Number.MAX_SAFE_INTEGER);
    const rows = db.prepare(`SELECT a.id,a.created_at,a.action,a.entity,a.entity_id,
        a.before_json,a.after_json,
        CASE WHEN u.role='superadmin' AND NOT ? THEN 'Atatau' ELSE COALESCE(a.actor_name,u.name) END AS author
      FROM audit_log a JOIN users u ON u.id=a.user_id
      WHERE a.id<? AND a.entity IN ('reservation','folio','folio_service','folio_payment',
        'cash_entry','pop_movement','lodging_exchange_rate')
      ORDER BY a.id DESC LIMIT 50`).all(canSeeSuperadmin(req.user), before);
    res.json(rows.map(({ before_json, after_json, ...row }) => ({
      ...row, before: JSON.parse(before_json), after: JSON.parse(after_json),
    })));
  });
  app.use("/api/users", users.management);
  app.use("/api/rooms", roomModule(db, users.admin));
  app.use("/api/reservations", reservationModule(db));
  app.use("/api/platforms", platformModule(db, users.admin));
  app.use("/api/notes", noteModule(db));
  app.use("/api/folios", folioModule(db));
  app.use("/api/cash", cashModule(db, users.admin));
  app.use(["/api/pub", "/api/pop"], popModule(db, users.admin));
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Ruta inexistente." }),
  );
  const dist = fileURLToPath(new URL("../../frontend/dist/", import.meta.url));
  app.use(express.static(dist));
  app.get("/{*path}", (req, res) => res.sendFile(`${dist}/index.html`));
  app.use((error, req, res, next) => {
    if (error.status && error.status < 500)
      return res
        .status(error.status)
        .json({
          error:
            error.type === "entity.parse.failed"
              ? "JSON inválido."
              : error.message,
        });
    console.error(error);
    res
      .status(500)
      .json({
        error:
          "No se pudo completar la operación. Los cambios de esta operación se revirtieron.",
      });
  });
  return app;
}
