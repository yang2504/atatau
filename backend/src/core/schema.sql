CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('superadmin','admin','receptionist')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS platforms (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type TEXT NOT NULL CHECK(type IN ('private','dorm')), capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 30),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id), label TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity > 0)
);
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY, guest_name TEXT NOT NULL, pax INTEGER NOT NULL CHECK(pax > 0),
  check_in TEXT NOT NULL, check_out TEXT NOT NULL CHECK(check_out > check_in),
  platform_id INTEGER NOT NULL REFERENCES platforms(id),
  status TEXT NOT NULL CHECK(status IN ('confirmed','in_house','checked_out','cancelled')) DEFAULT 'confirmed',
  folio_mode TEXT NOT NULL CHECK(folio_mode IN ('shared','individual')),
  comments TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS allocations (
  reservation_id INTEGER NOT NULL REFERENCES reservations(id), unit_id INTEGER NOT NULL REFERENCES units(id),
  PRIMARY KEY(reservation_id,unit_id)
);
CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL REFERENCES reservations(id), name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS folios (
  id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  guest_id INTEGER REFERENCES guests(id), title TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS folio_per_guest ON folios(guest_id) WHERE guest_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shared_folio ON folios(reservation_id) WHERE guest_id IS NULL;
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY, body TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('handover','maintenance','purchase','guest')),
  room_id INTEGER REFERENCES rooms(id), reservation_id INTEGER REFERENCES reservations(id),
  amount_cents INTEGER CHECK(amount_cents IS NULL OR amount_cents >= 0), resolved INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
