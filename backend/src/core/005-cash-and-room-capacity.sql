ALTER TABLE units ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
ALTER TABLE cash_entries ADD COLUMN cash_box TEXT NOT NULL DEFAULT 'petty' CHECK(cash_box IN ('petty','pub'));
CREATE INDEX cash_entries_box_day ON cash_entries(cash_box,day);
