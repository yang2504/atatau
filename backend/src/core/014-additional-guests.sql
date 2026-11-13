ALTER TABLE guests ADD COLUMN joined_on TEXT;
ALTER TABLE guests ADD COLUMN unit_id INTEGER REFERENCES units(id);
ALTER TABLE guests ADD COLUMN nightly_cents INTEGER CHECK(nightly_cents BETWEEN 0 AND 100000000);
CREATE INDEX guests_added_unit ON guests(unit_id) WHERE joined_on IS NOT NULL;
