import { useState, type FormEvent } from "react";
import type { Data, Room, User } from "../../lib/types";
import { api, today } from "../../lib/api";
import { ErrorBox, Icon, Empty, Modal } from "../../components/UI";
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
  const [editing, setEditing] = useState<Room | null>(null);
  const [editError, setEditError] = useState("");
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
  async function toggle(id: number, active: number) {
    setError("");
    try {
      await api(`/rooms/${id}`, { active }, "PATCH");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function edit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setEditError("");
    try {
      await api(`/rooms/${editing.id}`, {
        name: values.get("name"),
        capacity: Number(values.get("capacity")),
      }, "PATCH");
      await onSaved();
      setEditing(null);
    } catch (error) {
      setEditError((error as Error).message);
    } finally {
      setBusy(false);
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
              .filter((u) => u.active && !blocked.has(u.id))
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
                    <div className="row-actions">
                      <button className="text-button" onClick={() => { setEditing(room); setEditError(""); }}>
                        Editar
                      </button>
                      <button className="text-button" onClick={() => void toggle(room.id, room.active ? 0 : 1)}>
                        {room.active ? "Inhabilitar" : "Habilitar"}
                      </button>
                    </div>
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
      {editing && <Modal title="Editar habitación" onClose={() => { if (!busy) setEditing(null); }}>
        <form className="form-stack" onSubmit={edit}>
          <ErrorBox message={editError} />
          <label>Nombre<input name="name" defaultValue={editing.name} maxLength={80} required autoFocus /></label>
          <label>Capacidad total de personas<input name="capacity" type="number" min={1} max={30} defaultValue={editing.capacity} required /></label>
          <button className="button primary" disabled={busy}>Guardar cambios</button>
        </form>
      </Modal>}
    </div>
  );
}
