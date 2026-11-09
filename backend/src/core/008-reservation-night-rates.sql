CREATE TABLE reservation_night_rates (
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  day TEXT NOT NULL,
  nightly_cents INTEGER NOT NULL CHECK(nightly_cents BETWEEN 0 AND 100000000),
  PRIMARY KEY(reservation_id,day)
);
