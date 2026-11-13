import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/core/database.js";
import { currentTurn, turnFor } from "../src/modules/shifts.js";
import { closeOpenTurns } from "../src/modules/users.js";

test("un turno nocturno se conserva al volver a entrar y cambia al terminar el horario", () => {
  const db = openDatabase(":memory:");
  try {
    db.exec(`INSERT INTO users(id,name,username,password_hash,role)
      VALUES(1,'Prueba','prueba','unused','receptionist');
      INSERT INTO shift_schedules(user_id,weekday,start_minute,duration) VALUES(1,6,1320,480)`);
    const user = { id: 1, name: "Prueba" };
    const at = (value) => new Date(value);
    assert.equal(currentTurn(db, user, at("2026-11-09T03:00:00Z")).id, null);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cash_turns").get().count, 0);
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

test("las operaciones fuera de horario comparten un registro diario y un turno cerrado no se reutiliza", () => {
  const db = openDatabase(":memory:");
  try {
    db.exec(`INSERT INTO users(id,name,username,password_hash,role)
      VALUES(1,'Prueba','prueba','unused','receptionist');
      INSERT INTO shift_schedules(user_id,weekday,start_minute,duration) VALUES(1,0,480,480)`);
    const user = { id: 1, name: "Prueba" };
    const at = (time) => new Date(`2026-11-09T${time}:00Z`);
    const outside = turnFor(db, user, at("11:00"));
    assert.equal(currentTurn(db, user, at("11:30")).refresh_at, "2026-11-09T12:00:00.000Z");
    const shift = turnFor(db, user, at("13:00"));
    assert.notEqual(shift, outside);
    assert.equal(turnFor(db, user, at("20:30")), outside);
    db.exec("UPDATE shift_schedules SET duration=600");
    assert.equal(turnFor(db, user, at("20:30")), outside);
    assert.equal(db.prepare("SELECT expires_at FROM cash_turns WHERE id=?").get(shift).expires_at, "2026-11-09T20:00:00.000Z");
    db.exec("UPDATE shift_schedules SET start_minute=540");
    assert.equal(turnFor(db, user, at("20:30")), outside);
    db.prepare("UPDATE cash_turns SET closed_at=? WHERE id=?").run("2026-11-09T18:00:00.000Z", shift);
    db.exec("UPDATE shift_schedules SET start_minute=480,duration=480");
    assert.equal(turnFor(db, user, at("19:00")), outside);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cash_turns").get().count, 2);
  } finally {
    db.close();
  }
});
