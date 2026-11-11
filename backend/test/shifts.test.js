import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/core/database.js";
import { turnFor } from "../src/modules/shifts.js";
import { closeOpenTurns } from "../src/modules/users.js";

test("un turno nocturno se conserva al volver a entrar y cambia al terminar el horario", () => {
  const db = openDatabase(":memory:");
  try {
    db.exec(`INSERT INTO users(id,name,username,password_hash,role)
      VALUES(1,'Prueba','prueba','unused','receptionist');
      INSERT INTO shift_schedules(user_id,weekday,start_minute,duration) VALUES(1,6,1320,480)`);
    const user = { id: 1, name: "Prueba" };
    const shift = turnFor(db, user, new Date("2026-11-09T03:00:00Z"));
    closeOpenTurns(db);
    assert.equal(turnFor(db, user, new Date("2026-11-09T09:59:00Z")), shift);
    assert.notEqual(turnFor(db, user, new Date("2026-11-09T10:00:00Z")), shift);
    assert.equal(db.prepare("SELECT expires_at FROM cash_turns WHERE id=?").get(shift).expires_at,
      "2026-11-09T10:00:00.000Z");
  } finally {
    db.close();
  }
});
