CREATE TABLE cash_turns (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  user_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  closed_at TEXT
);
ALTER TABLE cash_entries ADD COLUMN turn_id INTEGER REFERENCES cash_turns(id);
ALTER TABLE folio_payments ADD COLUMN turn_id INTEGER REFERENCES cash_turns(id);
ALTER TABLE pop_movements ADD COLUMN turn_id INTEGER REFERENCES cash_turns(id);
CREATE INDEX cash_entries_turn ON cash_entries(turn_id);
CREATE INDEX folio_payments_turn ON folio_payments(turn_id);
CREATE INDEX pop_movements_turn ON pop_movements(turn_id);
CREATE INDEX cash_turns_user ON cash_turns(user_id, id DESC);

ALTER TABLE audit_log ADD COLUMN actor_name TEXT;
ALTER TABLE audit_log ADD COLUMN before_json TEXT;
ALTER TABLE audit_log ADD COLUMN after_json TEXT;
CREATE INDEX audit_record ON audit_log(entity, entity_id, id);

CREATE TABLE lodging_exchange_rate (
  id INTEGER PRIMARY KEY CHECK (id=1),
  scaled_rate INTEGER NOT NULL CHECK (scaled_rate BETWEEN 1 AND 10000000)
);
