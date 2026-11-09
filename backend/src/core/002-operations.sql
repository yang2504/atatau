CREATE TABLE reservations_new (
  id INTEGER PRIMARY KEY, guest_name TEXT NOT NULL, pax INTEGER NOT NULL CHECK(pax > 0),
  check_in TEXT NOT NULL, check_out TEXT NOT NULL CHECK(check_out > check_in),
  platform_id INTEGER NOT NULL REFERENCES platforms(id),
  status TEXT NOT NULL CHECK(status IN ('pending','confirmed','in_house','checked_out','cancelled')) DEFAULT 'confirmed',
  folio_mode TEXT NOT NULL CHECK(folio_mode IN ('shared','individual')),
  comments TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  nightly_cents INTEGER CHECK(nightly_cents BETWEEN 0 AND 100000000),
  arrival_time TEXT NOT NULL DEFAULT '',
  breakfast INTEGER NOT NULL DEFAULT 0 CHECK(breakfast IN (0,1))
);
INSERT INTO reservations_new
  (id,guest_name,pax,check_in,check_out,platform_id,status,folio_mode,comments,created_by,created_at,nightly_cents,arrival_time)
  SELECT id,guest_name,pax,check_in,check_out,platform_id,status,folio_mode,comments,created_by,created_at,nightly_cents,arrival_time
  FROM reservations;
DROP TABLE reservations;
ALTER TABLE reservations_new RENAME TO reservations;

ALTER TABLE users ADD COLUMN chat_color TEXT;
ALTER TABLE folio_payments ADD COLUMN surcharge_cents INTEGER NOT NULL DEFAULT 0 CHECK(surcharge_cents >= 0);

CREATE TABLE guest_rates (
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  pax INTEGER NOT NULL CHECK(pax BETWEEN 1 AND 30),
  breakfast INTEGER NOT NULL CHECK(breakfast IN (0,1)),
  nightly_cents INTEGER NOT NULL CHECK(nightly_cents BETWEEN 0 AND 100000000),
  PRIMARY KEY(room_id,pax,breakfast)
);

CREATE TABLE pop_products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 1 AND 100000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock BETWEEN 0 AND 1000000)
);
CREATE TABLE pop_movements (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES pop_products(id),
  day TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('in','out','sale')),
  quantity INTEGER NOT NULL CHECK(quantity > 0), detail TEXT NOT NULL,
  base_cents INTEGER NOT NULL DEFAULT 0, surcharge_cents INTEGER NOT NULL DEFAULT 0,
  method TEXT, user_id INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX pop_movements_day ON pop_movements(day);

CREATE TABLE cash_entries (
  id INTEGER PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
  detail TEXT NOT NULL, base_cents INTEGER NOT NULL CHECK(base_cents > 0),
  surcharge_cents INTEGER NOT NULL DEFAULT 0, method TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id), voided INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX cash_entries_day ON cash_entries(day);
CREATE INDEX folio_payments_day ON folio_payments(day);
