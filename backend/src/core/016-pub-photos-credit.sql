ALTER TABLE pop_products ADD COLUMN low_stock INTEGER NOT NULL DEFAULT 3 CHECK(low_stock BETWEEN 0 AND 1000000);
ALTER TABLE pop_movements ADD COLUMN folio_service_id INTEGER REFERENCES folio_services(id);
CREATE UNIQUE INDEX pop_movement_folio_service ON pop_movements(folio_service_id) WHERE folio_service_id IS NOT NULL;

CREATE TABLE pop_product_photos (
  product_id INTEGER PRIMARY KEY REFERENCES pop_products(id),
  jpeg BLOB NOT NULL CHECK(length(jpeg) BETWEEN 4 AND 204800),
  revision TEXT NOT NULL
);
