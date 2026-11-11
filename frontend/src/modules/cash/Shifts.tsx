import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { User } from "../../lib/types";
import { ErrorBox } from "../../components/UI";

const days = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const hours = Array.from({ length: 24 }, (_, index) => index);
type Shift = { id: number; user_id: number; weekday: number; start_minute: number; duration: number; name: string };
type Draft = Omit<Shift, "id" | "name"> & { id?: number };
const clock = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const timeMinute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const defaultDraft = { weekday: 0, start_minute: 480, duration: 480 };

export function Shifts() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() { setShifts(await api<Shift[]>("/shifts")); }
  useEffect(() => {
    void Promise.all([refresh(), api<User[]>("/users").then(setUsers)]).catch((e) => setError(e.message));
  }, []);
  const active = users.filter((user) => user.active);

  async function save(next: Draft, remove = false) {
    setBusy(true);
    setError("");
    const path = next.id ? `/shifts/${next.id}` : "/shifts";
    try {
      await api(remove ? path + "/remove" : path, remove ? {} : next, next.id && !remove ? "PUT" : "POST");
      setDraft(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function startDrag(event: DragEvent, value: Draft) {
    event.dataTransfer.setData("application/atatau-shift", JSON.stringify(value));
    event.dataTransfer.effectAllowed = value.id ? "move" : "copy";
  }
  function drop(event: DragEvent<HTMLDivElement>, weekday: number) {
    const value = event.dataTransfer.getData("application/atatau-shift");
    if (!value || busy) return;
    event.preventDefault();
    const column = event.currentTarget.getBoundingClientRect();
    const halfHour = Math.min(47, Math.max(0, Math.floor((event.clientY - column.top) * 48 / column.height)));
    try {
      const dragged: Draft = JSON.parse(value);
      void save({ ...dragged, weekday, start_minute: halfHour * 30 });
    } catch {
      setError("No se pudo leer el turno arrastrado.");
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const data = new FormData(event.currentTarget);
    const start = timeMinute(String(data.get("start")));
    const end = timeMinute(String(data.get("end")));
    const duration = end + (data.get("overnight") ? 1440 : 0) - start;
    if (duration < 1 || duration > 1440) {
      setError("El turno debe durar entre un minuto y 24 horas. Marca «Termina al día siguiente» si cruza medianoche.");
      return;
    }
    void save({ ...draft, user_id: Number(data.get("user")), weekday: Number(data.get("day")), start_minute: start, duration });
  }
  return <section className="panel shift-panel">
    <div className="section-toolbar">
      <div><h2>Horario semanal</h2><p>Arrastra una persona al día y hora de inicio. Arrastra un turno para moverlo o ábrelo para ajustar la duración.</p></div>
      <button className="button primary" disabled={busy || !active.length}
        onClick={() => setDraft({ ...defaultDraft, user_id: active[0].id })}>Agregar turno</button>
    </div>
    <ErrorBox message={error} />
    <div className="shift-people" aria-label="Personas disponibles">
      {active.map((user) => <button key={user.id} type="button" className="button secondary compact"
        draggable={!busy} disabled={busy} onDragStart={(event) => startDrag(event, { ...defaultDraft, user_id: user.id })}
        onClick={() => setDraft({ ...defaultDraft, user_id: user.id })}>{user.name}</button>)}
    </div>
    {draft && <form className="form-stack shift-form" key={`${draft.id ?? "new"}-${draft.user_id}-${draft.weekday}-${draft.start_minute}`} onSubmit={submit}>
      <div className="shift-fields">
        <label>Persona<select name="user" defaultValue={draft.user_id}>{active.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
        <label>Día<select name="day" defaultValue={draft.weekday}>{days.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
        <label>Desde<input name="start" type="time" defaultValue={clock(draft.start_minute)} required /></label>
        <label>Hasta<input name="end" type="time" defaultValue={clock(draft.start_minute + draft.duration)} required /></label>
        <label className="check-option"><input name="overnight" type="checkbox" defaultChecked={draft.start_minute + draft.duration >= 1440} /> Termina al día siguiente</label>
      </div>
      <div className="row-actions">
        <button className="button primary" disabled={busy}>Guardar turno</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button>
        {draft.id && <button type="button" className="text-button" disabled={busy}
          onClick={() => { if (window.confirm("¿Quitar este turno del horario semanal?")) void save(draft, true); }}>Quitar turno</button>}
      </div>
    </form>}
    <div className="shift-calendar" aria-label="Calendario semanal de turnos" tabIndex={0}>
      <div className="shift-grid">
        <div className="shift-day-name">Hora</div>
        {days.map((day) => <strong className="shift-day-name" key={day}>{day}</strong>)}
        <div className="shift-hours">{hours.map((hour) => <div key={hour}>{clock(hour * 60)}</div>)}</div>
        {days.map((day, weekday) => {
          const blocks = shifts.flatMap((shift) => {
            const end = shift.start_minute + shift.duration;
            if (shift.weekday === weekday) return [{ shift, from: shift.start_minute, to: Math.min(1440, end) }];
            if ((shift.weekday + 1) % 7 === weekday && end > 1440) return [{ shift, from: 0, to: end - 1440 }];
            return [];
          }).sort((a, b) => a.from - b.from);
          const lanes: number[] = [];
          const layout = blocks.map((block) => {
            const free = lanes.findIndex((end) => end <= block.from);
            const lane = free === -1 ? lanes.length : free;
            lanes[lane] = block.to;
            return { ...block, lane };
          });
          return <div className="shift-column" key={day} aria-label={day}
            onDragOver={(event) => { if (!busy && event.dataTransfer.types.includes("application/atatau-shift")) event.preventDefault(); }}
            onDrop={(event) => drop(event, weekday)}>
            {layout.map(({ shift, from, to, lane }) => <button type="button" key={shift.id}
              className="shift-block" draggable={!busy && shift.weekday === weekday} disabled={busy}
              onDragStart={(event) => startDrag(event, shift)} onClick={() => setDraft(shift)}
              style={{ top: `${from / 14.4}%`, height: `${(to - from) / 14.4}%`, left: `${lane * 100 / lanes.length}%`, width: `${100 / lanes.length}%` }}
              title={`${shift.name} · ${clock(shift.start_minute)} a ${clock(shift.start_minute + shift.duration)}`}>
              <strong>{shift.name}</strong><small>{clock(from)}–{to === 1440 ? "24:00" : clock(to)}</small>
            </button>)}
          </div>;
        })}
      </div>
    </div>
  </section>;
}
