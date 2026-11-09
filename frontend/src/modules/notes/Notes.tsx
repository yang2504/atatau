import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import type { Data, Note, User } from "../../lib/types";
import { addDays, api, today } from "../../lib/api";
import { ErrorBox, Icon } from "../../components/UI";
import { money } from "../../lib/money";
import { chatColor } from "../../lib/chatColor";

const categories: Record<string, string> = {
  handover: "Cambio de turno",
  maintenance: "Mantenimiento",
  purchase: "Compras",
  guest: "Huéspedes",
};
const dateLabel = new Intl.DateTimeFormat("es-BO", {
  timeZone: "America/La_Paz", weekday: "long", day: "numeric", month: "long", year: "numeric",
});
const timeLabel = new Intl.DateTimeFormat("es-BO", {
  timeZone: "America/La_Paz", hour: "2-digit", minute: "2-digit",
});

export function Notes({ data, user, onSaved }: {
  data: Data;
  user: User;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Note | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const day = today();
  const yesterday = addDays(day, -1);
  const notes = data.notes.filter((note) => {
    const sent = today(new Date(note.created_at));
    return sent === day || sent === yesterday;
  }).sort((a, b) => a.id - b.id);
  const visibleIds = new Set(notes.map((note) => note.id));
  const latest = notes.at(-1)?.id;
  const pending = data.notes.filter((note) => !note.resolved);
  useEffect(() => {
    if (follow.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [latest]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await api("/notes", {
        body: values.get("body"),
        category: values.get("category"),
        room_id: values.get("room_id") ? Number(values.get("room_id")) : null,
        reservation_id: values.get("reservation_id") ? Number(values.get("reservation_id")) : null,
        amount_cents: values.get("amount") ? Math.round(Number(values.get("amount")) * 100) : null,
        reply_to: reply?.id ?? null,
      });
      form.reset();
      setReply(null);
      follow.current = true;
      await onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resolve(note: Note) {
    setBusy(true);
    setError("");
    try {
      await api(`/notes/${note.id}`, { resolved: note.resolved ? 0 : 1 }, "PATCH");
      await onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function showMessage(id: number) {
    const container = list.current;
    const message = container?.querySelector<HTMLElement>(`#message-${id}`);
    if (!container || !message) return;
    message.focus({ preventScroll: true });
    container.scrollTop += message.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
  }

  return (
    <div className="content-columns chat-layout">
      <section className="panel chat-panel">
        <header className="chat-header"><Icon name="users" /><div><h2>Recepción Atatau</h2><small>Conversación de ayer y hoy · Hora de Bolivia</small></div></header>
        <div className="chat-thread" ref={list} aria-label="Conversación de ayer y hoy" role="log"
          onScroll={(event) => {
            const box = event.currentTarget;
            follow.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
          }}>
          {!notes.length && <p className="quiet-state">Todavía no hay mensajes de ayer ni de hoy.</p>}
          {notes.map((note, index) => {
            const created = new Date(note.created_at);
            const day = dateLabel.format(created);
            const prev = notes[index - 1];
            const color = chatColor(note.created_by, note.chat_color);
            return (
              <Fragment key={note.id}>
                {(!prev || dateLabel.format(new Date(prev.created_at)) !== day) && <div className="chat-day">{day}</div>}
                <article id={`message-${note.id}`} tabIndex={-1} className={`chat-message ${note.created_by === user.id ? "own" : ""}`} style={{ borderInlineStartColor: color }}>
                  <div className="chat-sender">
                    <span className="chat-avatar" style={{ backgroundColor: color }}>{note.author.slice(0, 1).toUpperCase()}</span>
                    <strong>{note.author}</strong>
                    <time dateTime={note.created_at}>{timeLabel.format(created)}</time>
                  </div>
                  {note.reply_author && <blockquote><strong>{note.reply_author}</strong> · {note.reply_preview}</blockquote>}
                  <p className="note-body">{note.body}</p>
                  <div className="note-links">
                    <span>{categories[note.category]}</span>
                    {note.room_name && <span>{note.room_name}</span>}
                    {note.guest_name && <span>{note.guest_name}</span>}
                    {note.amount_cents !== null && <span>Gasto {money(note.amount_cents)}</span>}
                  </div>
                  <div className="chat-actions">
                    <button className="text-button" type="button" onClick={() => { setReply(note); composer.current?.focus(); }}>Responder</button>
                    <button className="text-button" type="button" disabled={busy} onClick={() => void resolve(note)}>{note.resolved ? "Reabrir" : "Resolver"}</button>
                  </div>
                </article>
              </Fragment>
            );
          })}
        </div>
        <form onSubmit={submit} className="form-stack chat-composer">
          <ErrorBox message={error} />
          {reply && <div className="chat-reply"><span>En respuesta a <strong>{reply.author}</strong> · {reply.body.slice(0, 100)}</span><button type="button" className="icon-button" aria-label="Quitar respuesta" onClick={() => setReply(null)}>×</button></div>}
          <label>Mensaje para el equipo
            <textarea ref={composer} name="body" required maxLength={3000} rows={2} placeholder="Escribe una novedad o actualización…" />
          </label>
          <details>
            <summary>Agregar categoría o referencias</summary>
            <div className="form-grid">
              <label>Categoría<select name="category">{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label>Habitación<select name="room_id"><option value="">Sin habitación</option>{data.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
              <label>Reserva<select name="reservation_id"><option value="">Sin reserva</option>{data.reservations.map((r) => <option key={r.id} value={r.id}>#{r.id} · {r.guest_name}</option>)}</select></label>
              <label>Gasto informativo (Bs)<input name="amount" type="number" min={0} max={1000000} step="0.01" /></label>
            </div>
          </details>
          <button className="button primary" disabled={busy}>Enviar mensaje <Icon name="arrow" size={16} /></button>
        </form>
      </section>
      <aside className="panel side-form chat-pending">
        <h2>Pendientes <span className="count">{pending.length}</span></h2>
        <p className="muted">Siguen aquí hasta que alguien los resuelva.</p>
        {pending.length === 0 && <p className="quiet-state">El equipo está al día.</p>}
        {pending.map((note) => visibleIds.has(note.id) ? <button key={note.id} type="button" className="note-preview" onClick={() => showMessage(note.id)}>
          <span className="note-marker" style={{ backgroundColor: chatColor(note.created_by, note.chat_color) }} />
          <span><strong>{note.author}</strong><small>{note.body}</small></span><Icon name="chevron" size={15} />
        </button> : <details key={note.id} className="chat-old-pending">
          <summary>{note.author} · {dateLabel.format(new Date(note.created_at))}</summary>
          <p className="note-body">{note.body}</p>
          <button className="text-button" type="button" disabled={busy} onClick={() => void resolve(note)}>Resolver</button>
        </details>)}
      </aside>
    </div>
  );
}
