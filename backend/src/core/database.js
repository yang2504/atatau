import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function openDatabase(
  path = process.env.ATATAU_DB ||
    fileURLToPath(new URL("../../data/atatau.sqlite", import.meta.url)),
) {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
  );
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  transaction(db, () => {
    if (db.prepare("PRAGMA user_version").get().user_version === 0) {
      db.exec(
        readFileSync(new URL("./001-consumption.sql", import.meta.url), "utf8"),
      );
      db.exec("PRAGMA user_version = 1");
    }
  });
  if (db.prepare("PRAGMA user_version").get().user_version < 2) {
    // SQLite requires foreign keys off before rebuilding a referenced table.
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      transaction(db, () => {
        if (db.prepare("PRAGMA user_version").get().user_version >= 2) return;
        db.exec(readFileSync(new URL("./002-operations.sql", import.meta.url), "utf8"));
        if (db.prepare("PRAGMA foreign_key_check").get())
          throw new Error("La migración 002 dejaría referencias sin resolver.");
        db.exec("PRAGMA user_version = 2");
      });
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }
  if (db.prepare("PRAGMA user_version").get().user_version < 3) {
    transaction(db, () => {
      if (db.prepare("PRAGMA user_version").get().user_version >= 3) return;
      // Some installations already got this column with migration 002.
      if (!db.prepare("SELECT 1 FROM pragma_table_info('notes') WHERE name='reply_to'").get())
        db.exec(readFileSync(new URL("./003-note-replies.sql", import.meta.url), "utf8"));
      db.exec("PRAGMA user_version = 3");
    });
  }
  if (db.prepare("PRAGMA user_version").get().user_version < 4) {
    transaction(db, () => {
      if (db.prepare("PRAGMA user_version").get().user_version >= 4) return;
      db.exec(readFileSync(new URL("./004-check-in.sql", import.meta.url), "utf8"));
      db.exec("PRAGMA user_version = 4");
    });
  }
  if (db.prepare("PRAGMA user_version").get().user_version < 5) {
    transaction(db, () => {
      if (db.prepare("PRAGMA user_version").get().user_version >= 5) return;
      db.exec(readFileSync(new URL("./005-cash-and-room-capacity.sql", import.meta.url), "utf8"));
      db.exec("PRAGMA user_version = 5");
    });
  }
  if (db.prepare("PRAGMA user_version").get().user_version < 6) {
    transaction(db, () => {
      if (db.prepare("PRAGMA user_version").get().user_version >= 6) return;
      db.exec(readFileSync(new URL("./006-stay-payments.sql", import.meta.url), "utf8"));
      db.exec("PRAGMA user_version = 6");
    });
  }
  if (db.prepare("PRAGMA user_version").get().user_version < 7) {
    transaction(db, () => {
      if (db.prepare("PRAGMA user_version").get().user_version >= 7) return;
      db.exec(readFileSync(new URL("./007-folio-holder.sql", import.meta.url), "utf8"));
      db.exec("PRAGMA user_version = 7");
    });
  }
  if (db.prepare("PRAGMA user_version").get().user_version < 8) {
    transaction(db, () => {
      if (db.prepare("PRAGMA user_version").get().user_version >= 8) return;
      db.exec(readFileSync(new URL("./008-reservation-night-rates.sql", import.meta.url), "utf8"));
      db.exec("PRAGMA user_version = 8");
    });
  }
  if (db.prepare("PRAGMA user_version").get().user_version < 9) {
    transaction(db, () => {
      if (db.prepare("PRAGMA user_version").get().user_version >= 9) return;
      db.exec(readFileSync(new URL("./009-bcb-rate.sql", import.meta.url), "utf8"));
      db.exec("PRAGMA user_version = 9");
    });
  }
  db.prepare(
    "INSERT OR IGNORE INTO platforms (id,name,active) VALUES (1,'Sin reserva / directo',1),(2,'Booking',1),(3,'Hostelworld',1)",
  ).run();
  return db;
}

export function transaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
