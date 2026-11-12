import { Icon } from "../../components/UI";
import type { Room, RoomAssignment } from "../../lib/types";

export function GroupRooms({ rooms, assignments, occupied, datesReady, historical, onChange }: {
  rooms: Room[];
  assignments: RoomAssignment[];
  occupied: Set<number>;
  datesReady: boolean;
  historical: boolean;
  onChange: (assignments: RoomAssignment[]) => void;
}) {
  const selected = new Set(assignments.map((assignment) => assignment.room_id));
  const free = (room: Room) => room.units.filter((unit) => unit.active && !occupied.has(unit.id));
  const available = rooms.filter((room) => room.active && !selected.has(room.id));

  return (
    <section className="group-rooms" aria-label="Distribución del grupo">
      <div>
        <h3>Habitaciones y camas</h3>
        <p>Agrega al menos dos cuartos. En dormitorios, elige una cama por persona.</p>
      </div>
      {assignments.map((assignment) => {
        const room = rooms.find((room) => room.id === assignment.room_id)!;
        const update = (change: Partial<RoomAssignment>) => onChange(assignments.map((item) =>
          item.room_id === room.id ? { ...item, ...change } : item));
        const availableBeds = free(room).length;
        return (
          <fieldset className="group-room" key={room.id}>
            <legend>{room.name}</legend>
            <div className="group-room-heading">
              <span>{room.type === "private" ? `Privada · ${room.capacity} plazas`
                : `Dormitorio · ${assignment.pax} ${assignment.pax === 1 ? "cama elegida" : "camas elegidas"}`}</span>
              {!historical && <button type="button" className="text-button" aria-label={`Quitar ${room.name}`}
                onClick={() => onChange(assignments.filter((item) => item.room_id !== room.id))}>Quitar</button>}
            </div>
            {room.type === "private" ? (
              <label className="group-room-pax">
                Personas en {room.name}
                <input type="number" min={1} max={historical ? undefined : room.capacity} required
                  value={assignment.pax || ""} disabled={historical}
                  onChange={(event) => update({ pax: Number(event.target.value) })} />
              </label>
            ) : (
              <div className="bed-options">
                {room.units.filter((unit) => unit.active || assignment.unit_ids.includes(unit.id)).map((unit) => {
                  const checked = assignment.unit_ids.includes(unit.id);
                  const blocked = occupied.has(unit.id) || !unit.active || !room.active;
                  return (
                    <label key={unit.id} className={`bed-option${blocked ? " unavailable" : ""}`}>
                      <input type="checkbox" checked={checked} disabled={historical || (blocked && !checked)}
                        onChange={() => {
                          const unitIds = checked ? assignment.unit_ids.filter((id) => id !== unit.id)
                            : [...assignment.unit_ids, unit.id];
                          update({ unit_ids: unitIds, pax: unitIds.length });
                        }} />
                      {unit.label}{occupied.has(unit.id) ? " · ocupada" : (!unit.active || !room.active) && " · retirada"}
                    </label>
                  );
                })}
              </div>
            )}
            {!historical && (!room.active || assignment.unit_ids.some((id) =>
              !room.units.some((unit) => unit.id === id && unit.active) || occupied.has(id))) &&
              <p className="error">Revisa las plazas ocupadas o retiradas de {room.name}.</p>}
            {!historical && room.type === "dorm" && !assignment.unit_ids.length &&
              <p>{availableBeds ? "Elige las camas que ocupará el grupo." : "Sin camas libres para estas fechas."}</p>}
          </fieldset>
        );
      })}
      {!historical && <label className="group-add-room">
        <span><Icon name="plus" size={16} /> Agregar habitación o dormitorio</span>
        <select value="" disabled={!datesReady || !available.some((room) => free(room).length)}
          onChange={(event) => {
            const room = available.find((item) => item.id === Number(event.target.value));
            if (!room) return;
            onChange([...assignments, {
              room_id: room.id,
              pax: room.type === "private" ? 1 : 0,
              unit_ids: room.type === "private" ? [free(room)[0].id] : [],
            }]);
          }}>
          <option value="">{!datesReady ? "Elige las fechas de la estadía" : "Seleccionar cuarto"}</option>
          {available.map((room) => {
            const count = free(room).length;
            return <option key={room.id} value={room.id} disabled={!count}>
              {room.name} · {room.type === "private" ? (count ? `Privada · ${room.capacity} plazas` : "Privada · ocupada")
                : `Dormitorio · ${count} ${count === 1 ? "cama libre" : "camas libres"}`}
            </option>;
          })}
        </select>
        {datesReady && !available.some((room) => free(room).length) && <span>
          {available.length ? "No quedan otros cuartos disponibles en esas fechas." : "Ya agregaste todos los cuartos habilitados."}
        </span>}
      </label>}
    </section>
  );
}
