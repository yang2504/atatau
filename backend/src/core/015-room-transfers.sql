CREATE TABLE reservation_moves (
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  day TEXT NOT NULL,
  unit_id INTEGER NOT NULL REFERENCES units(id),
  PRIMARY KEY(reservation_id,day,unit_id)
);

CREATE VIEW reservation_occupancy AS
WITH move_dates AS (
  SELECT reservation_id,day,LEAD(day) OVER (PARTITION BY reservation_id ORDER BY day) AS next_day
  FROM (SELECT DISTINCT reservation_id,day FROM reservation_moves)
)
SELECT a.reservation_id,a.unit_id,r.check_in AS starts_on,
  COALESCE((SELECT MIN(m.day) FROM reservation_moves m WHERE m.reservation_id=r.id),r.check_out) AS ends_on,0 AS extra
FROM allocations a JOIN reservations r ON r.id=a.reservation_id
UNION ALL
SELECT m.reservation_id,m.unit_id,m.day,COALESCE(d.next_day,r.check_out),0
FROM reservation_moves m JOIN move_dates d USING(reservation_id,day)
JOIN reservations r ON r.id=m.reservation_id
UNION ALL
SELECT g.reservation_id,g.unit_id,g.joined_on,r.check_out,1
FROM guests g JOIN reservations r ON r.id=g.reservation_id WHERE g.joined_on IS NOT NULL;
