import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { fail, text, choice, integer, audit } from "../core/validation.js";
import { transaction } from "../core/database.js";

export const canSeeSuperadmin = (user) => Number(user?.role === "superadmin");

export function closeOpenTurns(db) {
  db.prepare("UPDATE cash_turns SET closed_at=MIN(expires_at,?) WHERE closed_at IS NULL")
    .run(new Date().toISOString());
}

const safe = (user) => ({
  id: user.id,
  name: user.name,
  username: user.username,
  role: user.role,
  active: user.active,
  chat_color: user.chat_color,
});
function usernameValue(value) {
  const username = text(value, "Usuario", 60);
  if (!/^[a-zA-Z0-9._-]+$/.test(username))
    fail("El usuario admite letras, números, punto, guion y guion bajo.");
  return username;
}
function hash(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function verify(password, stored) {
  const [salt, digest] = stored.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(digest, "hex"),
  );
}
function newUser(db, body, role) {
  const name = text(body.name, "Nombre", 100);
  const username = usernameValue(body.username);
  const password = text(body.password, "Contraseña", 128);
  if (password.length < 10)
    fail("La contraseña debe tener al menos 10 caracteres.");
  if (db.prepare("SELECT id FROM users WHERE username=?").get(username))
    fail("Ese usuario ya existe.", 409);
  const id = Number(
    db
      .prepare(
        "INSERT INTO users(name,username,password_hash,role) VALUES(?,?,?,?)",
      )
      .run(name, username, hash(password), role).lastInsertRowid,
  );
  return safe(db.prepare("SELECT * FROM users WHERE id=?").get(id));
}
export function userModule(db) {
  const router = Router(),
    sessions = new Map(),
    attempts = new Map();
  // Sessions live in memory. Close any previous server's turns at restart or expiry.
  closeOpenTurns(db);
  const closeTurn = db.prepare("UPDATE cash_turns SET closed_at=MIN(expires_at,?) WHERE id=? AND closed_at IS NULL");
  function tokenFrom(req) {
    return req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("atatau_session="))
      ?.slice(15);
  }
  function current(req) {
    const token = tokenFrom(req);
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expires <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    const user = db
      .prepare("SELECT * FROM users WHERE id=? AND active=1")
      .get(session.id);
    return user ? { ...safe(user), turnId: session.turnId } : null;
  }
  function login(req, res, user) {
    const now = Date.now();
    const expires = now + 12 * 3600000;
    const previousToken = tokenFrom(req);
    const previous = sessions.get(previousToken);
    const startedAt = new Date(now).toISOString();
    const turnId = transaction(db, () => {
      if (previous) closeTurn.run(startedAt, previous.turnId);
      return Number(db.prepare(`INSERT INTO cash_turns(user_id,user_name,started_at,expires_at)
        VALUES(?,?,?,?)`).run(user.id, user.name, startedAt, new Date(expires).toISOString()).lastInsertRowid);
    });
    sessions.delete(previousToken);
    for (const [key, entry] of sessions)
      if (entry.expires < Date.now()) sessions.delete(key);
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { id: user.id, expires, turnId });
    res.cookie("atatau_session", token, {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 12 * 3600000,
      path: "/",
    });
    res.json(user);
  }
  router.get("/status", (req, res) => {
    const user = current(req);
    res.json({
      setupRequired: !db.prepare("SELECT id FROM users LIMIT 1").get(),
      user: user ? safe(user) : null,
    });
  });
  router.post("/setup", (req, res) => {
    if (db.prepare("SELECT id FROM users LIMIT 1").get())
      fail("La configuración inicial ya se completó.", 409);
    login(req, res, newUser(db, req.body, "superadmin"));
  });
  router.post("/login", (req, res) => {
    const key = req.ip;
    const now = Date.now(),
      limit = attempts.get(key);
    if (limit && limit.until > now && limit.count >= 8)
      fail("Demasiados intentos. Espera 15 minutos.", 429);
    const username = text(req.body.username, "Usuario", 60);
    const password = text(req.body.password, "Contraseña", 128);
    const user = db
      .prepare("SELECT * FROM users WHERE username=? AND active=1")
      .get(username);
    if (!user || !verify(password, user.password_hash)) {
      attempts.set(key, {
        count: limit && limit.until > now ? limit.count + 1 : 1,
        until: limit && limit.until > now ? limit.until : now + 15 * 60000,
      });
      fail("Usuario o contraseña incorrectos.", 401);
    }
    attempts.delete(key);
    login(req, res, safe(user));
  });
  router.post("/logout", (req, res) => {
    const token = tokenFrom(req);
    const session = sessions.get(token);
    if (session) closeTurn.run(new Date().toISOString(), session.turnId);
    sessions.delete(token);
    res.clearCookie("atatau_session", { path: "/" });
    res.json({ ok: true });
  });
  function requireUser(req, res, next) {
    req.user = current(req);
    if (!req.user)
      return res.status(401).json({ error: "Inicia sesión para continuar." });
    next();
  }
  function admin(req, res, next) {
    if (req.user.role === "receptionist")
      return res.status(403).json({ error: "Se requiere una administradora." });
    next();
  }
  const management = Router();
  management.use(admin);
  management.get("/", (req, res) =>
    res.json(
      db
        .prepare(`SELECT id,name,username,role,active,chat_color
          FROM users WHERE role<>'superadmin' OR ? ORDER BY name`)
        .all(canSeeSuperadmin(req.user)),
    ),
  );
  management.post("/", (req, res) => {
    const role = choice(
      req.body.role,
      ["superadmin", "admin", "receptionist"],
      "Rol",
    );
    if (req.user.role !== "superadmin" && role !== "receptionist")
      fail("Solo el superadministrador puede crear administradores.", 403);
    const user = transaction(db, () => {
      const created = newUser(db, req.body, role);
      audit(db, req.user, "create", "user", created.id);
      return created;
    });
    res.status(201).json(user);
  });
  management.patch("/:id", (req, res) => {
    const id = integer(Number(req.params.id), "Usuario");
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (!user || (user.role === "superadmin" && !canSeeSuperadmin(req.user)))
      fail("Usuario inexistente.", 404);
    if (req.user.role !== "superadmin" && user.role !== "receptionist" && user.id !== req.user.id)
      fail("Solo el superadministrador puede modificar este usuario.", 403);
    const active = req.body.active === undefined ? user.active : integer(req.body.active, "Estado", 0, 1);
    const name = req.body.name === undefined ? user.name : text(req.body.name, "Nombre", 100);
    const username = req.body.username === undefined ? user.username : usernameValue(req.body.username);
    const color = req.body.chat_color === undefined ? user.chat_color : req.body.chat_color;
    if (color !== null && (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)))
      fail("Elige un color válido.");
    if (id === req.user.id && !active)
      fail("No puedes desactivar tu propio usuario.");
    transaction(db, () => {
      if (db.prepare("SELECT id FROM users WHERE username=? AND id<>?").get(username, id))
        fail("Ese usuario ya existe.", 409);
      db.prepare("UPDATE users SET active=?,name=?,username=?,chat_color=? WHERE id=?")
        .run(active, name, username, color, id);
      if (!active) db.prepare("UPDATE cash_turns SET closed_at=MIN(expires_at,?) WHERE user_id=? AND closed_at IS NULL")
        .run(new Date().toISOString(), id);
      audit(db, req.user, "update", "user", id);
    });
    if (!active) {
      for (const [token, session] of sessions)
        if (session.id === id) sessions.delete(token);
    }
    res.json({ ok: true, user: safe(db.prepare("SELECT * FROM users WHERE id=?").get(id)) });
  });
  return { router, requireUser, admin, management };
}
