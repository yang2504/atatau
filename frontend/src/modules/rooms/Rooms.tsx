import { useState, type FormEvent } from "react";
import type { Data, User } from "../../lib/types";
import { api, today } from "../../lib/api";
import { ErrorBox, Icon, Empty } from "../../components/UI";
export function Rooms({
  data,
  user,
  onSaved,
}: {
  data: Data;
  user: User;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const canManage = user.role !== "receptionist";
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await api("/rooms", {
        name: values.get("name"),
        type: values.get("type"),
        capacity: Number(values.get("capacity")),
      });
      await onSaved();
      form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(id: number, name: string, active: number) {
    setError("");
    try {
      await api(`/rooms/${id}`, { name, active }, "PATCH");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="content-columns">
      <section>
        <ErrorBox message={error} />
        <div className="room-cards">
          {data.rooms.map((room) => {
            const assigned = data.reservations.filter(
              (r) =>
                r.status !== "cancelled" &&
                r.check_in <= today() &&
                r.check_out > today() &&
                r.unit_ids.some((id) => room.units.some((u) => u.id === id)),
            );
            const pax = assigned.reduce((sum, r) => sum + r.pax, 0),
              blocked = new Set(assigned.flatMap((r) => r.unit_ids));
            const free = room.units
              .filter((u) => !blocked.has(u.id))
              .reduce((sum, u) => sum + u.capacity, 0);
            return (
              <article
                className={`panel room-card ${!room.active ? "disabled-card" : ""}`}
                key={room.id}
              >
                <div className="room-card-top">
                  <span className="room-icon">
                    <Icon name="bed" size={25} />
                  </span>
                  <span className="tag">
                    {room.type === "private" ? "Privada" : "Dormitorio"}
                  </span>
                </div>
                <h2>{room.name}</h2>
                <p>
                  {pax} de {room.capacity} personas asignadas hoy
                </p>
                <div className="capacity-dots">
                  {Array.from({ length: room.capacity }, (_, i) => (
                    <i className={i < pax ? "filled" : ""} key={i} />
                  ))}
                </div>
                <div className="room-bottom">
                  <span>
                    {room.active
                      ? `${free} plazas disponibles para reservar`
                      : "Inhabilitada"}
                  </span>
                  {canManage && (
                    <button
                      className="text-button"
                      onClick={() =>
                        void toggle(room.id, room.name, room.active ? 0 : 1)
                      }
                    >
                      {room.active ? "Inhabilitar" : "Habilitar"}
                    </button>
                  )}
                </div>
                {room.type === "private" && pax > 0 && (
                  <small className="muted">
                    Una privada ocupada se reserva completa.
                  </small>
                )}
              </article>
            );
          })}
        </div>
        {!data.rooms.length && (
          <Empty title="Aún no hay habitaciones">
            <p>Crea tu primera habitación para comenzar a reservar.</p>
          </Empty>
        )}
      </section>
      {canManage && (
        <aside className="panel side-form">
          <span className="eyebrow">CONFIGURACIÓN</span>
          <h2>Agregar habitación</h2>
          <p className="muted">
            Las camas de los dormitorios se crean automáticamente.
          </p>
          <form className="form-stack" onSubmit={create}>
            <label>
              Nombre
              <input
                name="name"
                required
                placeholder="Ej. Habitación 2"
                maxLength={80}
              />
            </label>
            <label>
              Tipo
              <select name="type">
                <option value="private">Privada / matrimonial</option>
                <option value="dorm">Dormitorio compartido</option>
              </select>
            </label>
            <label>
              Capacidad total de personas
              <input
                name="capacity"
                type="number"
                min={1}
                max={30}
                defaultValue={2}
                required
              />
            </label>
            <button className="button primary" disabled={busy}>
              Agregar habitación
            </button>
          </form>
        </aside>
      )}
    </div>
  );
}
