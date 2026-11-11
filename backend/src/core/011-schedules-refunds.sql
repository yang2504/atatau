CREATE TABLE shift_schedules (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
  duration INTEGER NOT NULL CHECK(duration BETWEEN 1 AND 1440)
);
CREATE INDEX shift_schedules_user ON shift_schedules(user_id);
ALTER TABLE cash_turns ADD COLUMN window_key TEXT;
CREATE UNIQUE INDEX cash_turns_window ON cash_turns(user_id,window_key);

CREATE TABLE folio_refunds (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES folio_payments(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  turn_id INTEGER NOT NULL REFERENCES cash_turns(id),
  day TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  reason TEXT NOT NULL
);
CREATE INDEX folio_refunds_payment ON folio_refunds(payment_id);
CREATE TABLE folio_refund_allocations (
  refund_id INTEGER NOT NULL REFERENCES folio_refunds(id),
  payment_id INTEGER NOT NULL REFERENCES folio_payments(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  PRIMARY KEY(refund_id,payment_id)
);
CREATE INDEX folio_refund_allocations_payment ON folio_refund_allocations(payment_id);
CREATE VIEW folio_payment_balances AS
SELECT p.*, p.amount_cents-COALESCE((
  SELECT SUM(a.amount_cents) FROM folio_refund_allocations a WHERE a.payment_id=p.id
),0) AS retained_cents
FROM folio_payments p;
