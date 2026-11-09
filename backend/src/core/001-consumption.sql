ALTER TABLE reservations ADD COLUMN nightly_cents INTEGER CHECK(nightly_cents BETWEEN 0 AND 100000000);
ALTER TABLE reservations ADD COLUMN arrival_time TEXT NOT NULL DEFAULT '';

CREATE TABLE room_rates (
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  platform_id INTEGER NOT NULL REFERENCES platforms(id),
  nightly_cents INTEGER NOT NULL CHECK(nightly_cents BETWEEN 0 AND 100000000),
  PRIMARY KEY(room_id, platform_id)
);

CREATE TABLE folio_services (
  id INTEGER PRIMARY KEY, folio_id INTEGER NOT NULL REFERENCES folios(id),
  day TEXT NOT NULL, service TEXT NOT NULL, detail TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK(total_cents BETWEEN 1 AND 100000000),
  user_id INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE folio_payments (
  id INTEGER PRIMARY KEY, folio_id INTEGER NOT NULL REFERENCES folios(id),
  lodging_day TEXT, service_id INTEGER REFERENCES folio_services(id),
  day TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
  method TEXT NOT NULL CHECK(method IN ('Efectivo','QR','Transferencia','Tarjeta','Otro')),
  user_id INTEGER NOT NULL REFERENCES users(id), voided INTEGER NOT NULL DEFAULT 0,
  CHECK ((lodging_day IS NULL) <> (service_id IS NULL))
);
CREATE INDEX folio_payments_lookup ON folio_payments(folio_id, lodging_day, service_id);
