CREATE TABLE bcb_usd_rate (
  id INTEGER PRIMARY KEY CHECK(id=1),
  rate TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
