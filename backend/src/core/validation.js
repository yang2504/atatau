export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
export function text(value, label, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(`${label}: completa un texto de hasta ${max} caracteres.`);
  return value.trim();
}
export function integer(value, label, min = 1, max = 1000000) {
  if (!Number.isInteger(value) || value < min || value > max)
    fail(`${label}: valor inválido.`);
  return value;
}
export function choice(value, values, label) {
  if (!values.includes(value)) fail(`${label}: opción inválida.`);
  return value;
}
export function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail("Fecha inválida. Usa AAAA-MM-DD.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    fail("Fecha inexistente.");
  return value;
}
export function audit(db, user, action, entity, id, before = null, after = null) {
  db.prepare(
    `INSERT INTO audit_log(user_id,action,entity,entity_id,actor_name,before_json,after_json)
     VALUES(?,?,?,?,?,?,?)`,
  ).run(user.id, action, entity, id, user.name,
    before === null ? null : JSON.stringify(before),
    after === null ? null : JSON.stringify(after));
}
