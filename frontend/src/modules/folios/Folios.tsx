import { useState } from "react";
import type { Data, Folio } from "../../lib/types";
import { shortDate, statusNames, today } from "../../lib/api";
import { Empty, Icon } from "../../components/UI";
import { folioMatches } from "../../lib/guestSearch";
export function Folios({
  data,
  onOpen,
}: {
  data: Data;
  onOpen: (folio: Folio) => void;
}) {
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [type, setType] = useState<"private" | "dorm">("private");
  const byId = new Map(
    data.reservations.map((reservation) => [reservation.id, reservation]),
  );
  const monthly = data.folios.filter((f) =>
    (f.check_in.slice(0, 7) === month || f.paid_months.includes(month)) &&
    folioMatches(query, f, byId.get(f.reservation_id)),
  );
  const folios = monthly.filter((f) => (f.room_type ?? "private") === type);
  return (
    <section className="panel">
      <div className="section-toolbar">
        <div>
          <h2>Hojas de consumo</h2>
          <p className="muted">
            Consulta las hojas por mes de llegada o de abono.
          </p>
        </div>
        <div className="row-actions">
          <label>Mes de las hojas <input type="month" value={month}
            onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} /></label>
          <input
            type="search"
            aria-label="Buscar cuenta"
            placeholder="Buscar por nombre…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="tabs" aria-label="Tipo de alojamiento" role="group">
        <button type="button" className={type === "private" ? "active" : ""}
          aria-pressed={type === "private"} onClick={() => setType("private")}>
          Habitaciones privadas · {monthly.filter((f) => f.room_type !== "dorm").length}
        </button>
        <button type="button" className={type === "dorm" ? "active" : ""}
          aria-pressed={type === "dorm"} onClick={() => setType("dorm")}>
          Dormitorios · {monthly.filter((f) => f.room_type === "dorm").length}
        </button>
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
            {query.trim()
              ? "Prueba con otro nombre o apellido."
              : "No hay hojas de este tipo para el mes seleccionado."}
          </p>
        </Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Hoja</th>
                <th>Titular</th>
                <th>Reserva</th>
                <th>Habitación</th>
                <th>Estadía</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {folios.map((f) => (
                <tr key={f.id}>
                  <td>
                    <span className="table-id">
                      <Icon name="book" size={16} />#{f.id}
                    </span>
                  </td>
                  <td>
                    <strong>{f.title}</strong>
                  </td>
                  <td>#{f.reservation_id}</td>
                  <td>{f.room_name ?? "Sin asignación"}</td>
                  <td>
                    {shortDate(f.check_in)} → {shortDate(f.check_out)}
                  </td>
                  <td>
                    {f.folio_mode === "shared" ? "Cuenta del grupo" : "Individual"}
                  </td>
                  <td>
                    <span className={`tag ${f.status}`}>
                      {statusNames[f.status]}
                    </span>
                  </td>
                  <td>
                    <button className="text-button" onClick={() => onOpen(f)}>
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
