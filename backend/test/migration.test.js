import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/core/database.js";

test("la migración 002 conserva reservas, novedades y cobros QR históricos", () => {
  const directory = mkdtempSync(join(tmpdir(), "atatau-migration-"));
  const path = join(directory, "version-1.sqlite");
  try {
    const old = new DatabaseSync(path);
    try {
      for (const file of ["schema.sql", "001-consumption.sql"])
        old.exec(readFileSync(new URL(`../src/core/${file}`, import.meta.url), "utf8"));
      old.exec(`
        INSERT INTO users(id,name,username,password_hash,role) VALUES(1,'Demo','demo','unused','admin');
        INSERT INTO platforms(id,name) VALUES(1,'Directo');
        INSERT INTO rooms(id,name,type,capacity) VALUES(1,'Privada','private',2);
        INSERT INTO units(id,room_id,label,capacity) VALUES(1,1,'Privada',2);
        INSERT INTO reservations(id,guest_name,pax,check_in,check_out,platform_id,status,folio_mode,created_by,nightly_cents)
          VALUES(1,'Demo',1,'2026-11-01','2026-11-03',1,'checked_out','shared',1,10000);
        INSERT INTO allocations VALUES(1,1);
        INSERT INTO guests(id,reservation_id,name) VALUES(1,1,'Demo');
        INSERT INTO folios(id,reservation_id,title) VALUES(1,1,'Demo');
        INSERT INTO folio_payments(folio_id,lodging_day,day,amount_cents,method,user_id)
          VALUES(1,'2026-11-01','2026-11-01',10000,'QR',1);
        INSERT INTO notes(body,category,reservation_id,created_by) VALUES('Mensaje histórico','handover',1,1);
        INSERT INTO audit_log(user_id,action,entity,entity_id) VALUES(1,'create','reservation',1);
        PRAGMA user_version=1;
      `);
    } finally {
      old.close();
    }
    const db = openDatabase(path);
    try {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 11);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reservation_night_rates").get().n, 0);
      assert.equal(db.prepare("SELECT folio_holder FROM reservations WHERE id=1").get().folio_holder, "");
      assert.equal(db.prepare("SELECT active FROM units WHERE id=1").get().active, 1);
      assert.equal(db.prepare("SELECT checked_in_by FROM reservations WHERE id=1").get().checked_in_by, null);
      assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("SELECT status FROM reservations WHERE id=1").get().status, "checked_out");
      assert.equal(db.prepare("SELECT COUNT(*) AS total FROM allocations").get().total, 1);
      assert.equal(db.prepare("SELECT body FROM notes WHERE reservation_id=1").get().body, "Mensaje histórico");
      const payment = db.prepare("SELECT amount_cents,surcharge_cents,group_id,turn_id FROM folio_payments").get();
      assert.equal(payment.group_id, null);
      assert.equal(payment.turn_id, null);
      assert.equal(db.prepare("SELECT before_json FROM audit_log WHERE entity_id=1").get().before_json, null);
      assert.equal(payment.amount_cents, 10000);
      assert.equal(payment.surcharge_cents, 0);
    } finally {
      db.close();
    }
  } finally {
    rmSync(path, { force: true });
    rmdirSync(directory);
  }
});

test("la migración 003 completa ambas variantes instaladas de la versión 002", () => {
  const directory = mkdtempSync(join(tmpdir(), "atatau-note-replies-"));
  try {
    for (const hasReplies of [false, true]) {
      const path = join(directory, `v2-${hasReplies}.sqlite`);
      try {
        const old = new DatabaseSync(path);
        try {
          old.exec("PRAGMA foreign_keys = OFF");
          for (const file of ["schema.sql", "001-consumption.sql", "002-operations.sql"])
            old.exec(readFileSync(new URL(`../src/core/${file}`, import.meta.url), "utf8"));
          old.exec(`
            INSERT INTO users(id,name,username,password_hash,role)
              VALUES(1,'Demo','demo','unused','admin');
            INSERT INTO notes(id,body,category,created_by)
              VALUES(1,'Mensaje anterior','handover',1);
            INSERT INTO cash_entries(day,kind,detail,base_cents,method,user_id)
              VALUES('2026-11-01','expense','Gasto anterior',1000,'Efectivo',1);
            PRAGMA user_version = 2;
          `);
          if (hasReplies) {
            old.exec(readFileSync(new URL("../src/core/003-note-replies.sql", import.meta.url), "utf8"));
            old.exec("INSERT INTO notes(body,category,created_by,reply_to) VALUES('Respuesta','handover',1,1)");
          }
        } finally {
          old.close();
        }
        const db = openDatabase(path);
        try {
          assert.equal(db.prepare("PRAGMA user_version").get().user_version, 11);
          assert.equal(db.prepare("SELECT cash_box FROM cash_entries").get().cash_box, "petty");
          const notes = db.prepare("SELECT body,reply_to FROM notes ORDER BY id").all();
          assert.equal(notes[0].body, "Mensaje anterior");
          assert.equal(notes[0].reply_to, null);
          if (hasReplies) assert.equal(notes[1].reply_to, 1);
        } finally {
          db.close();
        }
      } finally {
        rmSync(path, { force: true });
      }
    }
  } finally {
    rmdirSync(directory);
  }
});
