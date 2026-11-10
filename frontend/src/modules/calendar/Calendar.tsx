import { Fragment, useState } from "react";
import type { Data, Draft, Reservation } from "../../lib/types";
import {
  addDays,
  daysBetween,
  shortDate,
  statusNames,
  today,
} from "../../lib/api";
import { Icon, Empty } from "../../components/UI";
import { reservationStaff } from "../reservations/ReservationStaff";
import { nameMatches } from "../../lib/guestSearch";

export function Calendar({
  data,
  onCreate,
  onEdit,
  onExtend,
  onMove,
  onRooms,
}: {
  data: Data;
  onCreate: (draft: Draft) => void;
  onEdit: (r: Reservation) => void;
  onExtend: (r: Reservation) => void;
  onMove: (r: Reservation, unit: number, date: string) => Promise<void>;
  onRooms: () => void;
}) {
  const [start, setStart] = useState(() => addDays(today(), -2)),
    [filter, setFilter] = useState("all");
  const [roomQuery, setRoomQuery] = useState("");
  const [range, setRange] = useState(7);
  const [selection, setSelection] = useState<{
    unit: number;
    from: string;
    to: string;
  } | null>(null);
  const end = addDays(start, range);
  const currentDay = today();
  const days = Array.from({ length: range }, (_, i) => addDays(start, i));
  const occupiedByDay = days.map(
    (day) =>
      new Set(
        data.reservations
          .filter(
            (reservation) =>
              reservation.status !== "cancelled" &&
              reservation.check_in <= day &&
              day < reservation.check_out,
          )
          .flatMap((reservation) => reservation.unit_ids),
      ),
  );
  const rooms = data.rooms.filter(
    (r) => r.active && (filter === "all" || r.type === filter) && nameMatches(roomQuery, r.name),
  );
  const hasActiveRooms = data.rooms.some((room) => room.active);
  const title = new Intl.DateTimeFormat("es-BO", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${start}T00:00:00Z`));
  function finish(unit: number, day: string) {
    if (!selection || selection.unit !== unit) return;
    const from = selection.from < day ? selection.from : day,
      to = selection.from > day ? selection.from : day;
    setSelection(null);
    onCreate({ unit_id: unit, check_in: from, check_out: addDays(to, 1) });
  }
  return (
    <section
      className="panel calendar-panel"
      onPointerLeave={() => setSelection(null)}
    >
      <div className="calendar-toolbar">
        <div className="calendar-navigation">
          <h2>{title}</h2>
          <div className="button-group">
            <button
              aria-label={`${range} días anteriores`}
              onClick={() => setStart(addDays(start, -range))}
            >
              ‹
            </button>
            <button onClick={() => setStart(addDays(today(), -2))}>Hoy</button>
            <button
              aria-label={`${range} días siguientes`}
              onClick={() => setStart(end)}
            >
              ›
            </button>
          </div>
          <input
            aria-label="Ir a fecha"
            type="date"
            value={start}
            onInput={(e) => {
              if (e.currentTarget.value) setStart(e.currentTarget.value);
            }}
            onChange={(e) => {
              if (e.target.value) setStart(e.target.value);
            }}
          />
        </div>
        <div className="calendar-filters">
        <input type="search" aria-label="Buscar habitación en el calendario"
          placeholder="Buscar habitación…" value={roomQuery} onChange={(e) => setRoomQuery(e.target.value)} />
        <select aria-label="Días visibles" value={range} onChange={(e) => setRange(Number(e.target.value))}>
          <option value={7}>7 días · ampliado</option>
          <option value={14}>14 días</option>
        </select>
        <select
          aria-label="Filtrar habitaciones"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Todas las habitaciones</option>
          <option value="private">Solo privadas</option>
          <option value="dorm">Solo dormitorios</option>
        </select>
        </div>
      </div>
      {!rooms.length ? (
        <Empty
          title={
            hasActiveRooms
              ? "Sin habitaciones en este filtro"
              : "Tu recepción comienza aquí"
          }
        >
          {hasActiveRooms ? <>
            <p>Prueba con otro nombre o número de habitación.</p>
            <button className="button secondary" onClick={() => { setRoomQuery(""); setFilter("all"); }}>
              Quitar filtros
            </button>
          </> : <>
            <p>Agrega las habitaciones privadas y las camas de tus dormitorios.</p>
            <button className="button primary" onClick={onRooms}>
              Configurar habitaciones <Icon name="arrow" size={16} />
            </button>
          </>}
        </Empty>
      ) : (
        <>
          <p className="availability-guide">
            Cada fila de dormitorio es una cama. El contador indica camas libres / total por día.
          </p>
          <div className="calendar-scroll">
            <div className={`calendar-grid days-${range}`}>
              <div className="calendar-dates">
                <div className="resource-label">HABITACIÓN / CAMA</div>
                {days.map((day) => (
                  <div
                    key={day}
                    className={`date-heading ${day === currentDay ? "is-today" : ""}`}
                    aria-current={day === currentDay ? "date" : undefined}
                  >
                    <span>
                      {new Intl.DateTimeFormat("es", {
                        weekday: "short",
                        timeZone: "UTC",
                      })
                        .format(new Date(`${day}T00:00:00Z`))
                        .replace(".", "")}
                    </span>
                    <strong>{Number(day.slice(-2))}</strong>
                  </div>
                ))}
              </div>
              {rooms.map((room) => (
                <div key={room.id} className={`room-group room-${room.type}`}>
                  <div className="room-header">
                    <div>
                      <Icon name="bed" size={16} />
                      <div className="room-heading-text">
                        <strong title={room.name}>{room.name}</strong>
                        <small>{room.type === "private" ? "Privada" : "Dormitorio"}</small>
                      </div>
                    </div>
                    {days.map((day, index) => {
                      const free = room.units.filter(
                        (unit) => unit.active && !occupiedByDay[index].has(unit.id),
                      ).length;
                      const label =
                        room.type === "private"
                          ? free
                            ? "Libre"
                            : "Ocupada"
                          : `${free} de ${room.capacity} camas libres`;
                      return (
                        <span
                          key={day}
                          className={`room-day ${day === currentDay ? "is-today" : ""}`}
                          title={`${room.name} · ${shortDate(day)} · ${label}`}
                        >
                          <span className="availability-sr">
                            {shortDate(day)} · {label}
                          </span>
                          <span aria-hidden="true" className={`room-availability ${free ? "has-space" : ""}`}>
                            {room.type === "private"
                              ? label
                              : `${free}/${room.capacity}`}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                  {room.units.filter((unit) => unit.active || occupiedByDay.some((day) => day.has(unit.id))).map((unit) => (
                    <div className="calendar-row" key={unit.id}>
                      <div className="resource-name">
                        <span className={`unit-dot ${room.type}`} />
                        {room.type === "private"
                          ? "Habitación completa"
                          : unit.label}
                        {!unit.active && " · retirada"}
                      </div>
                      {days.map((day, index) => {
                        const selected =
                          selection?.unit === unit.id &&
                          day >=
                            (selection.from < selection.to
                              ? selection.from
                              : selection.to) &&
                          day <=
                            (selection.from > selection.to
                              ? selection.from
                              : selection.to);
                        return (
                          <button
                            key={day}
                            style={{ gridColumn: index + 2, gridRow: 1 }}
                            className={`calendar-cell ${day === currentDay ? "is-today" : ""} ${selected ? "selected" : ""}`}
                            disabled={!unit.active}
                            tabIndex={occupiedByDay[index].has(unit.id) ? -1 : 0}
                            aria-label={`${room.name}, ${unit.label}, ${day}: seleccionar fecha`}
                            onPointerDown={(e) => {
                              if (e.button === 0)
                                setSelection({
                                  unit: unit.id,
                                  from: day,
                                  to: day,
                                });
                            }}
                            onPointerEnter={() => {
                              if (selection?.unit === unit.id)
                                setSelection({ ...selection, to: day });
                            }}
                            onPointerUp={() => finish(unit.id, day)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onCreate({
                                  unit_id: unit.id,
                                  check_in: day,
                                  check_out: addDays(day, 1),
                                });
                              }
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const id = Number(
                                e.dataTransfer.getData(
                                  "text/atatau-reservation",
                                ),
                              );
                              const reservation = data.reservations.find(
                                (r) => r.id === id,
                              );
                              if (reservation)
                                void onMove(reservation, unit.id, day);
                            }}
                          />
                        );
                      })}
                      {data.reservations
                        .filter(
                          (r) =>
                            r.status !== "cancelled" &&
                            r.unit_ids.includes(unit.id) &&
                            r.check_in < end &&
                            r.check_out > start,
                        )
                        .map((r) => {
                          const left = Math.max(
                              0,
                              daysBetween(start, r.check_in),
                            ),
                            right = Math.min(
                              range,
                              daysBetween(start, r.check_out),
                            );
                          const visibleNights = days.slice(left, right);
                          const paymentStatus = (day: string) => {
                            const rate = r.night_rates[day] ?? r.nightly_cents;
                            return rate === null
                              ? "Sin tarifa"
                              : rate === 0
                                ? "Sin cargo"
                                : r.paid_nights.includes(day)
                                  ? "Pagada"
                                  : "Con saldo";
                          };
                          const extendable = unit.active && r.unit_ids[0] === unit.id && r.status !== "checked_out";
                          const staff = reservationStaff(r);
                          const responsible = staff[r.status === "checked_out" ? 2 : r.status === "in_house" ? 1 : 0];
                          const initials = responsible.name?.split(/\s+/).slice(0, 2)
                            .map((part) => [...part][0]).join("").toLocaleUpperCase("es-BO");
                          const staffDetail = staff.filter(({ name }) => name)
                            .map(({ label, name }) => `${label}: ${name}`).join(" · ");
                          const colors = visibleNights.map((day) => {
                            const status = paymentStatus(day);
                            return status === "Pagada"
                              ? "#f6ac69"
                              : status === "Con saldo"
                                ? "#ffdf78"
                                : "#e8ecea";
                          });
                          const stops = colors
                            .map(
                              (color, i) =>
                                `${color} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`,
                            )
                            .join(", ");
                          return (
                            <Fragment key={r.id}>
                            <button
                              draggable={!!unit.active}
                              className={`reservation-block ${r.status}${extendable ? " can-extend" : ""}${right - left === 1 ? " single-night" : ""}`}
                              style={{
                                gridColumn: `${left + 2} / ${right + 2}`,
                                background:
                                  r.status === "pending"
                                    ? "transparent"
                                    : colors.length === 1
                                    ? colors[0]
                                    : `linear-gradient(to right, ${stops})`,
                              }}
                              onClick={() => onEdit(r)}
                              onDragStart={(e) => {
                                setSelection(null);
                                e.dataTransfer.setData(
                                  "text/atatau-reservation",
                                  String(r.id),
                                );
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              aria-label={`${r.guest_name} · ${statusNames[r.status]} · ${r.pax} PAX${staffDetail ? ` · ${staffDetail}` : ""}`}
                              title={`${r.guest_name} · ${statusNames[r.status]} · ${r.pax} PAX\n${staffDetail}\n${visibleNights.map((day) => `${shortDate(day)}: ${paymentStatus(day)}`).join("\n")}`}
                            >
                              <span className="reservation-avatar">
                                <Icon name={room.type === "private" && r.pax > 1 ? "users" : "person"} size={15} />
                              </span>
                              <span>
                                <strong>{r.guest_name}</strong>
                                <small>
                                  {initials ? <span className="reservation-initials">{responsible.code}·{initials}</span>
                                    : room.type === "dorm" ? "1 cama" : `${r.pax} PAX`}
                                </small>
                              </span>
                            </button>
                            {extendable && <button
                              type="button"
                              className="reservation-extend"
                              style={{ gridColumn: right + 1 }}
                              aria-label={`Alargar estadía de ${r.guest_name}`}
                              title="Alargar estadía"
                              onClick={() => onExtend(r)}
                            ><Icon name="plus" size={15} /></button>}
                            </Fragment>
                          );
                        })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="calendar-footer">
        <div className="legend">
          <span>＋ Alargar estadía</span>
          <span>R Reserva · E Entrada · S Salida</span>
          <span><i className="legend-dot pending" /> Reserva pendiente</span>
          <span>
            <i className="legend-dot night-paid" />
            Noche pagada
          </span>
          <span>
            <i className="legend-dot night-due" />
            Noche con saldo
          </span>
          <span>
            <i className="legend-dot gray" />
            Sin tarifa o sin cargo
          </span>
        </div>
        <p>
          Arrastra sobre días libres para reservar · Arrastra una reserva para
          moverla
        </p>
      </div>
    </section>
  );
}
