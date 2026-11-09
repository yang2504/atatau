ALTER TABLE reservations ADD COLUMN checked_in_by INTEGER REFERENCES users(id);
ALTER TABLE reservations ADD COLUMN checked_in_at TEXT;
