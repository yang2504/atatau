import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api,
  addDays,
  daysBetween,
  roleNames,
  shortDate,
  statusNames,
  today,
} from "./lib/api";
import type { Data, Draft, Folio, Reservation, User } from "./lib/types";
import { nameMatches, reservationMatches } from "./lib/guestSearch";
import { ErrorBox, Icon, Empty, Modal } from "./components/UI";
import { Calendar } from "./modules/calendar/Calendar";
import { ReservationForm } from "./modules/reservations/ReservationForm";
import { ExtendStay } from "./modules/reservations/ExtendStay";
import { DollarRate } from "./components/DollarRate";
import { Rooms } from "./modules/rooms/Rooms";
import { Notes } from "./modules/notes/Notes";
import { Settings } from "./modules/settings/Settings";
import { Audit } from "./modules/settings/Audit";
import { Folios } from "./modules/folios/Folios";
import { FolioSheet } from "./modules/folios/FolioSheet";
import { GuestSearch } from "./modules/reservations/GuestSearch";
import { Cash } from "./modules/cash/Cash";
import { Shifts } from "./modules/cash/Shifts";
import { Pop } from "./modules/pop/Pop";
import { Breakfast } from "./modules/reservations/Breakfast";

const sections = [
  { title: "Recepción", pages: [
    ["calendar", "Calendario", "calendar"],
    ["reservations", "Reservas", "clipboard"],
    ["rooms", "Habitaciones", "bed"],
    ["folios", "Hojas de consumo", "receipt"],
  ] },
  { title: "Operación", pages: [
    ["notes", "Novedades", "chat"],
    ["breakfast", "Desayunos", "coffee"],
    ["cash", "Caja", "cash"],
    ["pop", "Inventario Pub", "box"],
  ] },
  { title: "Administración", pages: [
    ["settings", "Configuración", "settings"],
    ["shifts", "Turnos", "calendar"],
    ["audit", "Auditoría", "clipboard"],
  ] },
];
const descriptions: Record<string, string> = {
  calendar: "Consulta disponibilidad, llegadas y salidas por fecha.",
  reservations: "Llegadas, estadías y salidas en un solo lugar.",
  breakfast: "Consulta a quién le corresponde desayuno cada mañana.",
  rooms: "Revisa las habitaciones, sus camas y la disponibilidad.",
  folios: "Las cuentas de cada huésped, desde su reserva.",
  notes: "Consulta la conversación y los pendientes entre turnos.",
  cash: "Consulta los movimientos y registra los cobros de recepción.",
  pop: "Controla las existencias y registra las ventas del mostrador.",
  settings: "Organiza tus canales de reserva y tu equipo.",
  shifts: "Organiza el horario semanal del equipo.",
  audit: "Consulta quién hizo cada operación y qué cambió.",
};
const blank: Data = {
  rooms: [],
  reservations: [],
  platforms: [],
  notes: [],
  folios: [],
  lodgingExchangeRate: null,
};

function Auth({
  setup,
  onLogin,
}: {
  setup: boolean;
  onLogin: (user: User) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(
        await api<User>(
          `/auth/${setup ? "setup" : "login"}`,
          Object.fromEntries(new FormData(e.currentTarget)),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div className="brand">
          <span className="brand-symbol">a</span>
          <div>
            atatau<small>HOSTEL · RECEPCIÓN</small>
          </div>
        </div>
        <div>
          <span className="eyebrow">UN LUGAR PARA RECIBIR</span>
          <h1>
            Menos papeles.
            <br />
            Más hospitalidad.
          </h1>
          <p>
            Tu hostel, sus huéspedes y cada detalle del día.
            <br />
            Todo en un mismo lugar.
          </p>
          <div className="auth-illustration">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <small>
          Hecho para trabajar en tu equipo · Sin conexión a internet
        </small>
      </section>
      <section className="auth-form">
        <span className="eyebrow">BIENVENIDO A ATATAU</span>
        <h2>
          {setup ? "Preparemos tu recepción" : "Qué bueno verte de nuevo"}
        </h2>
        <p className="muted">
          {setup
            ? "Crea el primer superadministrador para comenzar."
            : "Inicia sesión para organizar el día."}
        </p>
        <form className="form-stack" onSubmit={submit}>
          <ErrorBox message={error} />
          {setup && (
            <label>
              Tu nombre
              <input name="name" autoComplete="name" required maxLength={100} />
            </label>
          )}
          <label>
            Usuario
            <input
              name="username"
              autoComplete="username"
              required
              maxLength={60}
            />
          </label>
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              minLength={setup ? 10 : 1}
              maxLength={128}
              required
            />
          </label>
          {setup && (
            <p className="small muted">
              Usa una contraseña de al menos 10 caracteres. El sistema guardará
              tus datos en este equipo.
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? "Un momento…" : setup ? "Comenzar" : "Entrar a recepción"}
            <Icon name="arrow" size={18} />
          </button>
        </form>
      </section>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [setup, setSetup] = useState(false),
    [loading, setLoading] = useState(true);
  const [data, setData] = useState<Data>(blank),
    [page, setPage] = useState("calendar"),
    [error, setError] = useState(""),
    [query, setQuery] = useState("");
  const [selectedFolio, setSelectedFolio] = useState<Folio | null>(null);
  const [folioReservation, setFolioReservation] = useState<Reservation | null>(null);
  const [summary, setSummary] = useState<"pax" | "free" | "arrivals" | "departures" | null>(null);
  const [extending, setExtending] = useState<Reservation | null>(null);
  const [editor, setEditor] = useState<{
    reservation?: Reservation;
    draft?: Draft;
  } | null>(null);
  const refresh = useCallback(async () => {
    const [rooms, reservations, platforms, notes, folios, exchange] = await Promise.all([
      api<Data["rooms"]>("/rooms"),
      api<Data["reservations"]>("/reservations"),
      api<Data["platforms"]>("/platforms"),
      api<Data["notes"]>("/notes"),
      api<Data["folios"]>("/folios"),
      api<{ scaled_rate: number | null }>("/lodging-exchange-rate"),
    ]);
    setData({ rooms, reservations, platforms, notes, folios, lodgingExchangeRate: exchange.scaled_rate });
  }, []);
  useEffect(() => {
    void api<{ setupRequired: boolean; user: User | null }>("/auth/status")
      .then((s) => {
        setSetup(s.setupRequired);
        setUser(s.user);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (user) void refresh().catch((e) => setError(e.message));
  }, [user, refresh]);
  useEffect(() => {
    if (!user || page !== "notes") return;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const notes = await api<Data["notes"]>("/notes");
        if (active) setData((current) => ({ ...current, notes }));
      } catch (error) {
        if (active) setError((error as Error).message);
      }
    }, 8000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [page, user]);
  async function onSaved() {
    await refresh();
    setError("");
  }
  function openReservationFolios(reservation: Reservation) {
    const folios = data.folios.filter((folio) => folio.reservation_id === reservation.id);
    if (!folios.length) return;
    setEditor(null);
    if (folios.length === 1) setSelectedFolio(folios[0]);
    else setFolioReservation(reservation);
  }
  async function move(r: Reservation, unit: number, date: string) {
    if (r.unit_ids.length !== 1) {
      setEditor({ reservation: r });
      setError(
        "Para mover una reserva de varias camas, selecciona todas las camas en el formulario.",
      );
      return;
    }
    try {
      await api(
        `/reservations/${r.id}`,
        {
          ...r,
          unit_ids: [unit],
          check_in: date,
          check_out: addDays(date, daysBetween(r.check_in, r.check_out)),
        },
        "PUT",
      );
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function logout() {
    try {
      await api("/auth/logout", {});
      setUser(null);
      setData(blank);
      setPage("calendar");
      setEditor(null);
      setSelectedFolio(null);
      setFolioReservation(null);
      setSummary(null);
      setExtending(null);
      setQuery("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (loading) return <div className="loading">Preparando recepción…</div>;
  if (!user)
    return (
      <>
        <ErrorBox message={error} />
        <Auth
          setup={setup}
          onLogin={(u) => {
            setUser(u);
            setSetup(false);
            setError("");
          }}
        />
      </>
    );
  const day = today(),
    active = data.reservations.filter(
      (r) => r.status !== "cancelled" && r.check_in <= day && r.check_out > day,
    );
  const units = data.rooms.filter((r) => r.active).flatMap((r) => r.units.filter((unit) => unit.active)),
    occupied = new Set(active.flatMap((r) => r.unit_ids));
  const capacity = data.rooms
    .filter((r) => r.active)
    .reduce((sum, r) => sum + r.capacity, 0);
  const freeUnits = units.filter((u) => !occupied.has(u.id));
  const free = freeUnits.reduce((sum, u) => sum + u.capacity, 0);
  const pax = active.reduce((sum, r) => sum + r.pax, 0),
    pending = data.notes.filter((n) => !n.resolved);
  const arrivals = data.reservations.filter(
    (r) => r.check_in === day && (r.status === "pending" || r.status === "confirmed"),
  );
  const departures = data.reservations.filter(
    (r) => r.check_out === day && r.status === "in_house",
  );
  const summaryTitle = {
    pax: "PAX asignados hoy", free: "Plazas disponibles",
    arrivals: "Llegadas pendientes", departures: "Salidas pendientes",
  };
  const summaryReservations = summary === "arrivals" ? arrivals : summary === "departures" ? departures : active;
  const section = sections.find((section) => section.pages.some(([key]) => key === page))!;
  const [, title, pageIcon] = section.pages.find(([key]) => key === page)!;
  const visibleReservations =
    page === "reservations"
      ? data.reservations.filter(
          (reservation) =>
            reservationMatches(query, reservation) ||
            nameMatches(query, reservation.platform_name),
        )
      : [];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">Ir al contenido</a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-symbol">a</span>
          <div>
            atatau<small>HOSTEL · RECEPCIÓN</small>
          </div>
        </div>
        <nav aria-label="Navegación principal">
          {sections.filter(({ title }) => title !== "Administración" || user.role !== "receptionist").map(({ title, pages }) => (
            <div className="nav-group" key={title}>
              <p className="workspace-label">{title}</p>
              {pages.map(([key, label, icon]) => (
                <button
                  key={key}
                  type="button"
                  aria-label={label}
                  aria-current={page === key ? "page" : undefined}
                  title={label}
                  className={page === key ? "active" : ""}
                  onClick={() => {
                    setPage(key);
                    window.scrollTo(0, 0);
                  }}
                >
                  <Icon name={icon} size={19} />
                  <span>{label}</span>
                  {key === "notes" && pending.length > 0 && (
                    <b aria-label={`${pending.length} pendientes`}>{pending.length}</b>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-indicator">
            <i />
            Operación local<small>Tus datos, en este equipo</small>
          </div>
          <div className="user-panel">
            <span className="avatar">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{roleNames[user.role]}</small>
            </div>
            <button
              className="icon-button"
              onClick={() => void logout()}
              aria-label="Cerrar sesión"
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            {section.title} <Icon name="chevron" size={13} /> <strong>{title}</strong>
          </div>
          <GuestSearch data={data}
            onReservation={(reservation) => setEditor({ reservation })}
            onFolio={setSelectedFolio}
          />
          <DollarRate />
          <div className="topbar-date">
            <Icon name="calendar" size={17} />
            {new Intl.DateTimeFormat("es-BO", {
              weekday: "short",
              day: "numeric",
              month: "long",
              timeZone: "America/La_Paz",
            }).format(new Date())}
          </div>
        </header>
        <div className="page-content" id="workspace-content" tabIndex={-1}>
          <div className="page-heading">
            <div className="page-heading-main">
              <span className="page-icon"><Icon name={pageIcon} size={25} /></span>
              <div>
                <span className="eyebrow">{section.title}</span>
                <h1>{title}</h1>
                <p>{descriptions[page]}</p>
              </div>
            </div>
            {(page === "calendar" || page === "reservations") && <button
              className="button primary"
              onClick={() => setEditor({})}
              disabled={!data.rooms.some((r) => r.active)}
            >
              <Icon name="plus" size={18} />
              Nueva reserva
            </button>}
          </div>
          <ErrorBox message={error} />
          {page === "calendar" && (
            <>
              <div className="stats">
                <Stat
                  label={summaryTitle.pax}
                  value={String(pax)}
                  detail={`de ${capacity} plazas totales`}
                  icon="users"
                  onClick={() => setSummary("pax")}
                />
                <Stat
                  label={summaryTitle.free}
                  value={String(free)}
                  detail="para reservar esta noche"
                  icon="bed"
                  onClick={() => setSummary("free")}
                />
                <Stat
                  label={summaryTitle.arrivals}
                  value={String(arrivals.length).padStart(2, "0")}
                  detail="reservas para hoy"
                  icon="calendar"
                  onClick={() => setSummary("arrivals")}
                />
                <Stat
                  label={summaryTitle.departures}
                  value={String(departures.length).padStart(2, "0")}
                  detail="reservas para hoy"
                  icon="logout"
                  onClick={() => setSummary("departures")}
                />
              </div>
              <Calendar
                data={data}
                onCreate={(draft) => setEditor({ draft })}
                onEdit={(reservation) => setEditor({ reservation })}
                onExtend={setExtending}
                onFolio={openReservationFolios}
                onMove={move}
                onRooms={() => setPage("rooms")}
              />
              <div className="dashboard-bottom">
                <section className="panel arrivals-panel">
                  <div className="section-title">
                    <h2>
                      En la agenda de hoy{" "}
                      <span className="count">
                        {arrivals.length + departures.length}
                      </span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => setPage("reservations")}
                    >
                      Ver reservas <Icon name="arrow" size={16} />
                    </button>
                  </div>
                  {!arrivals.length && !departures.length ? (
                    <p className="quiet-state">
                      Sin llegadas ni salidas pendientes. Un buen momento para
                      revisar las próximas reservas.
                    </p>
                  ) : (
                    <div className="agenda-list">
                      {[...arrivals, ...departures].map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setEditor({ reservation: r })}
                        >
                          <span className="avatar small-avatar">
                            {r.guest_name[0]}
                          </span>
                          <span>
                            <strong>{r.guest_name}</strong>
                            <small>
                              {r.platform_name} · {r.pax} PAX
                            </small>
                          </span>
                          <span
                            className={`tag ${r.status === "pending" ? "pending" : r.check_in === day ? "confirmed" : "checked_out"}`}
                          >
                            {r.status === "pending" ? "Llegada · Por confirmar" : r.check_in === day ? "Llegada" : "Salida"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
                <section className="panel recent-notes">
                  <div className="section-title">
                    <h2>Entre turnos</h2>
                    <button
                      className="text-button"
                      onClick={() => setPage("notes")}
                    >
                      Ver todas <Icon name="arrow" size={16} />
                    </button>
                  </div>
                  {pending.length ? (
                    pending.slice(0, 2).map((n) => (
                      <button
                        key={n.id}
                        className="note-preview"
                        onClick={() => setPage("notes")}
                      >
                        <span className={`note-marker ${n.category}`} />
                        <span>
                          <strong>
                            {n.room_name ||
                              n.guest_name ||
                              "Novedad de recepción"}
                          </strong>
                          <small>{n.body}</small>
                        </span>
                        <Icon name="chevron" size={15} />
                      </button>
                    ))
                  ) : (
                    <p className="quiet-state">
                      Sin novedades pendientes. Deja una nota para el siguiente
                      turno cuando la necesites.
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
          {page === "rooms" && (
            <Rooms data={data} user={user} onSaved={onSaved} />
          )}
          <div hidden={page !== "notes"} key={user.id}>
            <Notes data={data} user={user} onSaved={onSaved} active={page === "notes"} />
          </div>
          {page === "cash" && <Cash user={user} />}
          {page === "shifts" && user.role !== "receptionist" && <Shifts />}
          {page === "audit" && user.role !== "receptionist" && <Audit />}
          {page === "breakfast" && <Breakfast reservations={data.reservations} />}
          {page === "pop" && <Pop user={user} />}
          {page === "settings" && user.role !== "receptionist" && (
            <Settings data={data} user={user} onSaved={onSaved} onUserChanged={setUser} />
          )}
          {page === "folios" && (
            <Folios data={data} onOpen={setSelectedFolio} />
          )}
          {page === "reservations" && (
            <section className="panel">
              <div className="section-toolbar">
                <h2>
                  Todas las reservas{" "}
                  <span className="count">{visibleReservations.length}</span>
                </h2>
                <input
                  type="search"
                  placeholder="Buscar huésped o plataforma…"
                  aria-label="Buscar reservas"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {!data.reservations.length ? (
                <Empty title="Tu primera reserva está por llegar">
                  <p>
                    Agrega una habitación y luego selecciona las fechas en el
                    calendario.
                  </p>
                </Empty>
              ) : !visibleReservations.length ? (
                <Empty title="No se encontraron reservas">
                  <p>Prueba con otro nombre, apellido o plataforma.</p>
                </Empty>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Huésped</th>
                        <th>Estadía</th>
                        <th>Habitación / camas</th>
                        <th>PAX</th>
                        <th>Canal</th>
                        <th>Estado</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleReservations.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>{r.guest_name}</strong>
                            <small className="cell-sub">Reserva #{r.id}</small>
                          </td>
                          <td>
                            {shortDate(r.check_in)} → {shortDate(r.check_out)}
                            <small className="cell-sub">
                              {daysBetween(r.check_in, r.check_out)} noches
                            </small>
                          </td>
                          <td>
                            {data.rooms
                              .filter((room) =>
                                room.units.some((u) =>
                                  r.unit_ids.includes(u.id),
                                ),
                              )
                              .map((room) => (
                                <span key={room.id}>
                                  {room.name}
                                  <small className="cell-sub">
                                    {room.type === "dorm"
                                      ? room.units
                                          .filter((u) =>
                                            r.unit_ids.includes(u.id),
                                          )
                                          .map((u) => u.label)
                                          .join(", ")
                                      : "Habitación completa"}
                                  </small>
                                </span>
                              ))}
                          </td>
                          <td>{r.pax}<small className="cell-sub">{r.breakfast ? "Con desayuno" : "Sin desayuno"}</small></td>
                          <td>{r.platform_name}</td>
                          <td>
                            <span className={`tag ${r.status}`}>
                              {statusNames[r.status]}
                            </span>
                            {r.checked_in_by_name && <small className="cell-sub">Recibió {r.checked_in_by_name}</small>}
                          </td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => setEditor({ reservation: r })}
                            >
                              Editar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          <footer className="page-footer">
            HOSTEL ATATAU{" "}
            <span>
              Un espacio para recibir, una forma más simple de organizar.
            </span>
          </footer>
        </div>
      </main>
      {summary && <Modal title={summaryTitle[summary]} onClose={() => setSummary(null)}>
        <p className="summary-date">{shortDate(day, true)}</p>
        {summary === "free" ? freeUnits.length ? (
          <ul className="summary-places">
            {freeUnits.map((unit) => {
              const room = data.rooms.find((item) => item.id === unit.room_id);
              return <li key={unit.id}>
                <strong>{room?.name}</strong>
                <span>{unit.label} · {unit.capacity} {unit.capacity === 1 ? "plaza" : "plazas"}</span>
              </li>;
            })}
          </ul>
        ) : <p>No hay plazas disponibles para esta noche.</p> : summaryReservations.length ? (
          <div className="agenda-list summary-reservations">
            {summaryReservations.map((reservation) => {
              const room = data.rooms.find((item) => item.units.some((unit) => reservation.unit_ids.includes(unit.id)));
              const beds = room?.type === "dorm"
                ? room.units.filter((unit) => reservation.unit_ids.includes(unit.id)).map((unit) => unit.label).join(", ")
                : "";
              return <button type="button" key={reservation.id} onClick={() => {
                setSummary(null);
                setEditor({ reservation });
              }}>
                <span className="summary-guest">
                  <strong>{reservation.guest_name} · #{reservation.id}</strong>
                  <small>{[room?.name, beds, `${reservation.pax} PAX`].filter(Boolean).join(" · ")}</small>
                  <small>{shortDate(reservation.check_in)} → {shortDate(reservation.check_out)}
                    {summary === "arrivals" && reservation.arrival_time && ` · Llegada prevista ${reservation.arrival_time}`}</small>
                  {reservation.guests.length > 1 && <small>
                    Huéspedes · {reservation.guests.map((guest) => guest.name).join(", ")}
                  </small>}
                </span>
                <span className={`tag ${reservation.status}`}>
                  {reservation.status === "pending" ? "Por confirmar" : statusNames[reservation.status]}
                </span>
              </button>;
            })}
          </div>
        ) : <p>No hay registros para hoy.</p>}
      </Modal>}
      {folioReservation && <Modal title={`Hojas de consumo · Reserva #${folioReservation.id}`}
        onClose={() => setFolioReservation(null)}>
        <div className="agenda-list summary-reservations">
          {data.folios.filter((folio) => folio.reservation_id === folioReservation.id).map((folio) =>
            <button type="button" key={folio.id} onClick={() => {
              setFolioReservation(null);
              setSelectedFolio(folio);
            }}>
              <Icon name="receipt" size={17} />
              <span><strong>{folio.title}</strong><small>Hoja #{folio.id}</small></span>
            </button>)}
        </div>
      </Modal>}
      {selectedFolio && (
        <FolioSheet
          folio={selectedFolio}
          data={data}
          user={user}
          onClose={() => setSelectedFolio(null)}
          onSaved={onSaved}
        />
      )}
      {editor && (
        <ReservationForm
          data={data}
          reservation={editor.reservation}
          draft={editor.draft}
          onOpenFolio={editor.reservation && data.folios.some((folio) => folio.reservation_id === editor.reservation?.id)
            ? openReservationFolios : undefined}
          onClose={() => setEditor(null)}
          onSaved={onSaved}
        />
      )}
      {extending && <ExtendStay
        reservation={extending}
        room={data.rooms.find((room) => room.units.some((unit) => extending.unit_ids.includes(unit.id)))}
        onClose={() => setExtending(null)}
        onSaved={onSaved}
      />}
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="panel stat" onClick={onClick} aria-haspopup="dialog">
      <span className="stat-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </span>
      <span className="stat-icon">
        <Icon name={icon} size={22} />
      </span>
    </button>
  );
}
