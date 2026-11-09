ALTER TABLE reservations ADD COLUMN folio_holder TEXT NOT NULL DEFAULT '';
CREATE INDEX folios_reservation ON folios(reservation_id);
