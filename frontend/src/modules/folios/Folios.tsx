import { useState } from "react";
import type { Data, Folio } from "../../lib/types";
import { shortDate, statusNames, today } from "../../lib/api";
import { Empty, Icon } from "../../components/UI";
import { folioMatches, nameMatches } from "../../lib/guestSearch";
export function Folios({
  data,
  onOpen,
}: {
  data: Data;
  onOpen: (folio: Folio) => void;
}) {
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [allMonths, setAllMonths] = useState(false);
  const [type, setType] = useState<"private" | "dorm">("private");
  const [roomId, setRoomId] = useState<number | null>(null);
  const byId = new Map(
    data.reservations.map((reservation) => [reservation.id, reservation]),
  );
  const roomsById = new Map(data.rooms.map((room) => [room.id, room]));
  const roomsByFolio = new Map(data.folios.map((folio) => {
    const reservation = byId.get(folio.reservation_id);
    const assignments = reservation?.room_assignments ?? [];
    const ids = reservation?.moves.length ? data.rooms.filter((room) => room.units.some((unit) =>
      reservation.occupancy.some((span) => span.unit_id === unit.id))).map((room) => room.id)
      : assignments.length ? assignments.map((item) => item.room_id) : [folio.room_id];
    return [folio.id, ids.flatMap((id) => {
      const room = id === null ? undefined : roomsById.get(id);
      return room ? [room] : [];
    })] as const;
  }));
  const folioRooms = (folio: Folio) => roomsByFolio.get(folio.id) ?? [];
  const matchesType = (folio: Folio, kind: typeof type) => {
    const rooms = folioRooms(folio);
    return rooms.length ? rooms.some((room) => room.type === kind) : (folio.room_type ?? "private") === kind;
  };
  const matchesRoom = (folio: Folio, id: number) => folioRooms(folio).some((room) => room.id === id);
  const monthly = data.folios.filter((f) =>
    (allMonths || ((f.joined_on ?? f.check_in).slice(0, 7) <= month && f.check_out > month + "-01") ||
      f.paid_months.includes(month) || f.service_months.includes(month)) &&
    (query.trim().replace(/^#/, "") === String(f.reservation_id) ||
      folioMatches(query, f, byId.get(f.reservation_id)) ||
      (!!query.trim() && folioRooms(f).some((room) => nameMatches(query, room.name)))),
  );
  const byType = monthly.filter((f) => matchesType(f, type));
  const historicalRooms = new Set(data.folios.flatMap((folio) => folioRooms(folio).map((room) => room.id)));
  const roomTabs = data.rooms.filter((room) => room.type === type && (room.active || historicalRooms.has(room.id)));
  const folios = roomId === null ? byType : byType.filter((f) => matchesRoom(f, roomId));
  function changeType(next: typeof type) {
    if (next !== type) setRoomId(null);
    setType(next);
  }
  return (
    <section className="panel">
      <div className="section-toolbar folio-toolbar">
        <div>
          <h2>Hojas de consumo</h2>
          <p className="muted">
            Busca por habitación, huésped o reserva. El mes incluye estadías, consumos y abonos.
          </p>
        </div>
        <div className="row-actions">
          <label>Mes de las hojas <input type="month" value={month} disabled={allMonths}
            onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} /></label>
          <label className="check-option"><input type="checkbox" checked={allMonths}
            onChange={(e) => setAllMonths(e.target.checked)} /> Todos los meses</label>
          <label>Huésped o reserva<input
            type="search"
            placeholder="Nombre o # de reserva"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          /></label>
        </div>
      </div>
      <div className="tabs" aria-label="Tipo de alojamiento" role="group">
        <button type="button" className={type === "private" ? "active" : ""}
          aria-pressed={type === "private"} onClick={() => changeType("private")}>
          Habitaciones privadas · {monthly.filter((f) => matchesType(f, "private")).length}
        </button>
        <button type="button" className={type === "dorm" ? "active" : ""}
          aria-pressed={type === "dorm"} onClick={() => changeType("dorm")}>
          Dormitorios · {monthly.filter((f) => matchesType(f, "dorm")).length}
        </button>
      </div>
      <div className="tabs folio-room-tabs" aria-label="Habitaciones" role="group">
        <button type="button" className={roomId === null ? "active" : ""}
          aria-pressed={roomId === null} onClick={() => setRoomId(null)}>
          {type === "dorm" ? "Todos los dormitorios" : "Todas las privadas"} · {byType.length}
        </button>
        {roomTabs.map((room) => <button key={room.id} type="button"
          className={roomId === room.id ? "active" : ""} aria-pressed={roomId === room.id}
          onClick={() => setRoomId(room.id)}>
          {room.name}{!room.active && " (inactiva)"} · {byType.filter((folio) => matchesRoom(folio, room.id)).length}
        </button>)}
      </div>
      {!folios.length ? (
        <Empty
          title={
            query.trim()
              ? "No se encontraron hojas"
              : "Sin cuentas para mostrar"
          }
        >
          <p>
            No hay hojas para los filtros seleccionados.
          </p>
        </Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Habitación</th>
                <th>Estadía</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {folios.map((f) => (
                <tr key={f.id}>
                  <td>
                    <strong className="table-id"><Icon name="book" size={16} />{f.title}</strong>
                    <small className="cell-sub">
                      Hoja #{f.id} · Reserva #{f.reservation_id} · {f.folio_mode === "shared" ? "Cuenta del grupo" : "Individual"}
                    </small>
                  </td>
                  <td>{folioRooms(f).map((room) => room.name).join(" · ") || f.room_name || "Sin asignación"}</td>
                  <td>
                    {shortDate(f.joined_on ?? f.check_in, true)} → {shortDate(f.check_out, true)}
                  </td>
                  <td>
                    <span className={`tag ${f.status}`}>
                      {statusNames[f.status]}
                    </span>
                  </td>
                  <td>
                    <button className="button secondary compact" onClick={() => onOpen(f)}>
                      Abrir hoja
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
