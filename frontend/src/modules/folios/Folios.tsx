import { useState } from "react";
import type { Data, Folio } from "../../lib/types";
import { shortDate, statusNames } from "../../lib/api";
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
  const byId = new Map(
    data.reservations.map((reservation) => [reservation.id, reservation]),
  );
  const folios = data.folios.filter((f) =>
    folioMatches(query, f, byId.get(f.reservation_id)),
  );
  return (
    <section className="panel">
      <div className="section-toolbar">
        <div>
          <h2>Hojas de consumo</h2>
          <p className="muted">
            Consulta el hospedaje, los servicios y el saldo de cada cuenta.
          </p>
        </div>
        <input
          type="search"
          aria-label="Buscar cuenta"
          placeholder="Buscar por huésped…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
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
              : "Una reserva puede tener una hoja conjunta o una por persona."}
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
                  <td>
                    {shortDate(f.check_in)} → {shortDate(f.check_out)}
                  </td>
                  <td>
                    {f.folio_mode === "shared" ? "Conjunta" : "Individual"}
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
