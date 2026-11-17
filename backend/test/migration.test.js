import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/core/database.js";

test("la migración 019 conserva cobros agrupados, turnos, anulaciones y reembolsos", () => {
  const directory = mkdtempSync(join(tmpdir(), "atatau-camilo-migration-"));
  const path = join(directory, "v18.sqlite");
  try {
    const old = new DatabaseSync(path);
    try {
      const core = new URL("../src/core/", import.meta.url);
      old.exec(readFileSync(new URL("schema.sql", core), "utf8"));
      for (const file of readdirSync(core).filter((file) => /^0(?:0[1-9]|1[0-8])-.*\.sql$/.test(file)).sort())
        old.exec(readFileSync(new URL(file, core), "utf8"));
      old.exec(`INSERT INTO users(id,name,username,password_hash,role) VALUES(1,'QA','qa','unused','admin');
        INSERT INTO platforms(id,name) VALUES(1,'Directo');
        INSERT INTO reservations(id,guest_name,pax,check_in,check_out,platform_id,status,folio_mode,created_by)
          VALUES(1,'QA',1,'2026-11-01','2026-11-03',1,'in_house','shared',1);
        INSERT INTO folios(id,reservation_id,title) VALUES(1,1,'QA');
        INSERT INTO cash_turns(id,user_id,user_name,started_at,expires_at) VALUES(1,1,'QA','2026-11-01T00:00:00Z','2026-11-02T00:00:00Z');
        INSERT INTO folio_payments(id,folio_id,lodging_day,day,amount_cents,method,user_id,group_id,turn_id)
          VALUES(1,1,'2026-11-01','2026-11-01',10000,'QR',1,1,1),(2,1,'2026-11-02','2026-11-01',10000,'QR',1,1,1);
        INSERT INTO folio_payments(id,folio_id,lodging_day,day,amount_cents,method,user_id,voided)
          VALUES(3,1,'2026-11-01','2026-11-01',500,'Efectivo',1,1);
        INSERT INTO folio_refunds(id,payment_id,user_id,turn_id,day,amount_cents,reason) VALUES(1,1,1,1,'2026-11-02',1000,'QA');
        INSERT INTO folio_refund_allocations VALUES(1,2,1000);
        PRAGMA user_version=18;`);
    } finally { old.close(); }
    const db = openDatabase(path);
    try {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 19);
      assert.deepEqual(db.prepare("SELECT id,group_id,turn_id,retained_cents FROM folio_payment_balances WHERE id<3 ORDER BY id").all().map((r) => ({ ...r })),
        [{ id: 1, group_id: 1, turn_id: 1, retained_cents: 10000 }, { id: 2, group_id: 1, turn_id: 1, retained_cents: 9000 }]);
      assert.equal(db.prepare("SELECT voided FROM folio_payments WHERE id=3").get().voided, 1);
      assert.equal(db.prepare("SELECT payment_id FROM folio_refunds WHERE id=1").get().payment_id, 1);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { db.close(); }
  } finally {
    rmSync(path, { force: true });
    rmdirSync(directory);
  }
});

test("la migración 017 conserva productos, fotos y ventas de una base instalada", () => {
  const directory = mkdtempSync(join(tmpdir(), "atatau-pub-migration-"));
  const path = join(directory, "v16.sqlite");
  try {
    const old = new DatabaseSync(path);
    try {
      old.exec("PRAGMA foreign_keys = OFF");
      const core = new URL("../src/core/", import.meta.url);
      const scripts = readdirSync(core).filter((file) => /^0(?:0[1-9]|1[0-6])-.*\.sql$/.test(file)).sort();
      for (const file of ["schema.sql", ...scripts]) old.exec(readFileSync(new URL(file, core), "utf8"));
      old.exec(`INSERT INTO users(id,name,username,password_hash,role) VALUES(1,'Demo','demo','unused','admin');
        INSERT INTO pop_categories(id,name) VALUES(2,'Bebidas');
        INSERT INTO pop_products(id,name,price_cents,stock,category_id,low_stock) VALUES(3,'Agua',500,8,2,4);
        INSERT INTO pop_product_photos(product_id,jpeg,revision) VALUES(3,x'FFD8FFD9','foto');
        INSERT INTO pop_movements(product_id,day,kind,quantity,detail,base_cents,user_id)
          VALUES(3,'2026-11-16','sale',2,'Agua × 2',1000,1);
        PRAGMA user_version = 16;`);
    } finally { old.close(); }
    const db = openDatabase(path);
    try {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 19);
      const product = db.prepare("SELECT * FROM pop_products WHERE id=3").get();
      assert.deepEqual([product.name, product.stock, product.category_id, product.low_stock, product.deleted_at], ["Agua", 8, 2, 4, null]);
      assert.equal(db.prepare("SELECT revision FROM pop_product_photos WHERE product_id=3").get().revision, "foto");
      assert.equal(db.prepare("SELECT base_cents FROM pop_movements WHERE product_id=3").get().base_cents, 1000);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { db.close(); }
  } finally {
    rmSync(path, { force: true });
    rmdirSync(directory);
  }
});

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
        INSERT INTO folio_services(id,folio_id,day,service,detail,total_cents,user_id)
          VALUES(1,1,'2026-11-01','Consumo','Cargo histórico',1000,1);
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
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 19);
      assert.equal(db.prepare("SELECT joined_on FROM guests WHERE id=1").get().joined_on, null);
      assert.deepEqual({ ...db.prepare("SELECT total_cents,voided FROM folio_services WHERE id=1").get() },
        { total_cents: 1000, voided: 0 });
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reservation_night_rates").get().n, 0);
      assert.equal(db.prepare("SELECT folio_holder FROM reservations WHERE id=1").get().folio_holder, "");
      assert.equal(db.prepare("SELECT active FROM units WHERE id=1").get().active, 1);
      assert.equal(db.prepare("SELECT checked_in_by FROM reservations WHERE id=1").get().checked_in_by, null);
      assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("SELECT status FROM reservations WHERE id=1").get().status, "checked_out");
      assert.equal(db.prepare("SELECT COUNT(*) AS total FROM allocations").get().total, 1);
      assert.equal(db.prepare("SELECT pax FROM allocations WHERE reservation_id=1").get().pax, null);
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
            INSERT INTO pop_products(name,price_cents,stock) VALUES('Producto histórico',1000,3);
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
          assert.equal(db.prepare("PRAGMA user_version").get().user_version, 19);
          const product = db.prepare("SELECT stock,category_id FROM pop_products WHERE name='Producto histórico'").get();
          assert.equal(product.stock, 3);
          assert.equal(product.category_id, null);
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
