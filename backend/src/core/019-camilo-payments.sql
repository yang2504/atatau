DROP VIEW folio_payment_balances;
CREATE TABLE folio_payments_new (
  id INTEGER PRIMARY KEY, folio_id INTEGER NOT NULL REFERENCES folios(id),
  lodging_day TEXT, service_id INTEGER REFERENCES folio_services(id),
  day TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
  method TEXT NOT NULL CHECK(method IN ('Efectivo','QR','Transferencia','Tarjeta','Otro','A/C CAMILO')),
  user_id INTEGER NOT NULL REFERENCES users(id), voided INTEGER NOT NULL DEFAULT 0,
  surcharge_cents INTEGER NOT NULL DEFAULT 0 CHECK(surcharge_cents>=0),
  group_id INTEGER REFERENCES folio_payments(id), turn_id INTEGER REFERENCES cash_turns(id),
  CHECK ((lodging_day IS NULL) <> (service_id IS NULL)),
  CHECK (method<>'A/C CAMILO' OR lodging_day IS NOT NULL)
);
INSERT INTO folio_payments_new SELECT id,folio_id,lodging_day,service_id,day,amount_cents,method,user_id,
  voided,surcharge_cents,group_id,turn_id FROM folio_payments;
DROP TABLE folio_payments;
ALTER TABLE folio_payments_new RENAME TO folio_payments;
CREATE INDEX folio_payments_lookup ON folio_payments(folio_id,lodging_day,service_id);
CREATE INDEX folio_payments_day ON folio_payments(day);
CREATE INDEX folio_payments_group ON folio_payments(group_id);
CREATE INDEX folio_payments_turn ON folio_payments(turn_id);
CREATE VIEW folio_payment_balances AS
SELECT p.*, p.amount_cents-COALESCE((
  SELECT SUM(a.amount_cents) FROM folio_refund_allocations a WHERE a.payment_id=p.id
),0) AS retained_cents FROM folio_payments p;
