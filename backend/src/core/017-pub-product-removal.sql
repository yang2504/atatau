CREATE TABLE pop_products_new (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 1 AND 100000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock BETWEEN 0 AND 1000000),
  category_id INTEGER REFERENCES pop_categories(id) ON DELETE SET NULL,
  low_stock INTEGER NOT NULL DEFAULT 3 CHECK(low_stock BETWEEN 0 AND 1000000),
  deleted_at TEXT
);
INSERT INTO pop_products_new(id,name,price_cents,active,stock,category_id,low_stock)
SELECT id,name,price_cents,active,stock,category_id,low_stock FROM pop_products;
DROP TABLE pop_products;
ALTER TABLE pop_products_new RENAME TO pop_products;
CREATE UNIQUE INDEX pop_products_catalog_name ON pop_products(name) WHERE deleted_at IS NULL;
CREATE INDEX pop_products_category ON pop_products(category_id);
