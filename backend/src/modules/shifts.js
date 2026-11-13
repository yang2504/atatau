import { Router } from "express";
import { localDay } from "../core/charges.js";
import { transaction } from "../core/database.js";
import { audit, fail, integer } from "../core/validation.js";

const dayMs = 86400000;
const weekMinutes = 7 * 1440;

export function currentTurn(db, user, now = new Date()) {
  const at = now.toISOString();
  const active = db.prepare(`SELECT * FROM cash_turns WHERE user_id=? AND window_key LIKE 'weekly:%'
    AND closed_at IS NULL AND started_at<=? AND expires_at>? ORDER BY id DESC LIMIT 1`)
    .get(user.id, at, at);
  if (active) return active;

  const day = localDay(now);
  const midnight = Date.parse(day + "T00:00:00-04:00");
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  const schedules = db.prepare("SELECT * FROM shift_schedules WHERE user_id=?").all(user.id);
  let start = midnight;
  let end = midnight + dayMs;
  let nextStart = end;
  let scheduled = false;
  for (const offset of [-1, 0]) {
    for (const shift of schedules) {
      if (shift.weekday !== (weekday + offset + 7) % 7) continue;
      const from = midnight + offset * dayMs + shift.start_minute * 60000;
      const to = from + shift.duration * 60000;
      if (from > now) nextStart = Math.min(nextStart, from);
      if (from <= now && now < to) {
        start = from;
        end = to;
        scheduled = true;
        break;
      }
    }
    if (scheduled) break;
  }
  const find = db.prepare("SELECT * FROM cash_turns WHERE user_id=? AND window_key=?");
  if (scheduled) {
    const begins = new Date(start).toISOString();
    const ends = new Date(end).toISOString();
    const windowKey = "weekly:" + begins;
    const existing = find.get(user.id, windowKey);
    // Schedule edits cannot reopen a closed slot or create another that overlaps it.
    const overlaps = !existing && db.prepare(`SELECT 1 FROM cash_turns WHERE user_id=?
      AND window_key LIKE 'weekly:%' AND started_at<? AND COALESCE(closed_at,expires_at)>? LIMIT 1`)
      .get(user.id, ends, begins);
    if (existing ? !existing.closed_at && existing.expires_at > at : !overlaps)
      return existing ?? { id: null, user_name: user.name, started_at: begins, expires_at: ends,
        window_key: windowKey };
  }
  const begins = new Date(midnight).toISOString();
  const windowKey = "outside:" + begins;
  const existing = find.get(user.id, windowKey);
  if (existing?.closed_at || (existing && existing.expires_at <= at)) return null;
  const turn = existing ?? { id: null, user_name: user.name, started_at: begins,
    expires_at: new Date(midnight + dayMs).toISOString(), window_key: windowKey };
  return { ...turn, refresh_at: new Date(nextStart).toISOString() };
}

export function turnFor(db, user, now = new Date()) {
  const turn = currentTurn(db, user, now);
  if (!turn) fail("Este turno ya cerró. Revisa el horario en Turnos.", 409);
  if (turn.id !== null) return turn.id;
  return db.prepare(`INSERT INTO cash_turns(user_id,user_name,started_at,expires_at,window_key)
    VALUES(?,?,?,?,?) ON CONFLICT(user_id,window_key) DO NOTHING RETURNING id`)
    .get(user.id, user.name, turn.started_at, turn.expires_at, turn.window_key)?.id ??
    currentTurn(db, user, now)?.id ?? fail("El turno cambió. Vuelve a intentar.", 409);
}

export function shiftModule(db, admin) {
  const router = Router();
  router.use(admin);
  const find = db.prepare("SELECT * FROM shift_schedules WHERE id=?");
  router.get("/", (req, res) => res.json(db.prepare(`SELECT s.*,u.name FROM shift_schedules s
    JOIN users u ON u.id=s.user_id WHERE u.active=1 AND (u.role<>'superadmin' OR ?)
    ORDER BY s.weekday,s.start_minute,s.id`).all(Number(req.user.role === "superadmin"))));

  function mayManage(userId, actor) {
    const user = db.prepare("SELECT role,active FROM users WHERE id=?").get(userId);
    if (!user?.active || (user.role === "superadmin" && actor.role !== "superadmin"))
      fail("Usuario de turno inexistente.", 404);
  }
  function save(req, res) {
    const id = req.params.id ? integer(Number(req.params.id), "Turno") : null;
    const userId = integer(req.body.user_id, "Usuario");
    const weekday = integer(req.body.weekday, "Día", 0, 6);
    const minute = integer(req.body.start_minute, "Hora de inicio", 0, 1439);
    const duration = integer(req.body.duration, "Duración", 1, 1440);
    const saved = transaction(db, () => {
      const before = id ? find.get(id) : null;
      if (id && !before) fail("Turno inexistente.", 404);
      if (before) mayManage(before.user_id, req.user);
      mayManage(userId, req.user);
      const start = weekday * 1440 + minute;
      const overlaps = db.prepare("SELECT * FROM shift_schedules WHERE user_id=? AND id<>?")
        .all(userId, id ?? 0).some((shift) => [-weekMinutes, 0, weekMinutes].some((offset) => {
          const other = shift.weekday * 1440 + shift.start_minute + offset;
          return other < start + duration && other + shift.duration > start;
        }));
      if (overlaps) fail("La persona ya tiene un turno en ese horario.", 409);
      const row = id
        ? db.prepare(`UPDATE shift_schedules SET user_id=?,weekday=?,start_minute=?,duration=? WHERE id=? RETURNING *`)
          .get(userId, weekday, minute, duration, id)
        : db.prepare(`INSERT INTO shift_schedules(user_id,weekday,start_minute,duration) VALUES(?,?,?,?) RETURNING *`)
          .get(userId, weekday, minute, duration);
      audit(db, req.user, id ? "update" : "create", "shift_schedule", row.id, before, row);
      return row;
    });
    res.status(id ? 200 : 201).json(saved);
  }
  router.post("/", save);
  router.put("/:id", save);
  router.post("/:id/remove", (req, res) => {
    const id = integer(Number(req.params.id), "Turno");
    transaction(db, () => {
      const before = find.get(id);
      if (!before) fail("Turno inexistente.", 404);
      mayManage(before.user_id, req.user);
      db.prepare("DELETE FROM shift_schedules WHERE id=?").run(id);
      audit(db, req.user, "delete", "shift_schedule", id, before, null);
    });
    res.json({ ok: true });
  });
  return router;
}
