CREATE TABLE pop_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

ALTER TABLE pop_products ADD COLUMN category_id INTEGER
  REFERENCES pop_categories(id) ON DELETE SET NULL;
CREATE INDEX pop_products_category ON pop_products(category_id);
