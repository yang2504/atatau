ALTER TABLE folio_payments ADD COLUMN group_id INTEGER REFERENCES folio_payments(id);
CREATE INDEX folio_payments_group ON folio_payments(group_id);
