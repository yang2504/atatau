import { useEffect, useState } from "react";
import { ErrorBox, Icon } from "../../components/UI";
import { addDays, api, statusNames, today } from "../../lib/api";
import type { Reservation } from "../../lib/types";

type BreakfastGuest = {
  id: number;
  name: string;
  holder: string;
  reservation_id: number;
  room_name: string;
  status: Reservation["status"];
};

export function Breakfast({ reservations }: { reservations: Reservation[] }) {
  const [day, setDay] = useState(today);
  const [result, setResult] = useState<{ day: string; guests: BreakfastGuest[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setError("");
    void api<BreakfastGuest[]>(`/reservations/breakfast?day=${encodeURIComponent(day)}`)
      .then((guests) => { if (current) setResult({ day, guests }); })
      .catch((error: Error) => { if (current) setError(error.message); });
    return () => { current = false; };
  }, [day, reservations]);

  const guests = result?.day === day ? result.guests : null;
  const pending = guests?.filter((guest) => guest.status === "pending").length ?? 0;

  return (
    <>
      {guests && <dl className="breakfast-totals">
        <div className="panel metric-card breakfast-total">
          <dt className="metric-label"><span className="metric-icon breakfast-total-icon"><Icon name="coffee" size={24} /></span>Desayunos confirmados</dt>
          <dd className="metric-value">{guests.length - pending}</dd>
        </div>
        <div className="panel metric-card breakfast-total">
          <dt className="metric-label"><span className="metric-icon breakfast-total-icon"><Icon name="clock" size={24} /></span>Por confirmar</dt>
          <dd className="metric-value">{pending}</dd>
        </div>
      </dl>}
      <section className="panel breakfast-report" aria-labelledby="breakfast-title">
        <div className="section-toolbar breakfast-toolbar">
          <h2 id="breakfast-title"><Icon name="calendar" size={24} /> Reporte diario de desayunos</h2>
          <div className="breakfast-date-controls">
            <div className="button-group">
              <button type="button" aria-label="Día anterior" onClick={() => setDay(addDays(day, -1))}><Icon name="chevron" size={16} /></button>
              <button type="button" onClick={() => setDay(today())}>Hoy</button>
              <button type="button" aria-label="Día siguiente" onClick={() => setDay(addDays(day, 1))}><Icon name="chevron" size={16} /></button>
            </div>
            <input type="date" aria-label="Fecha del desayuno" value={day} onChange={(e) => { if (e.target.value) setDay(e.target.value); }} />
          </div>
        </div>
        <ErrorBox message={error} />
        {guests ? <>
          {guests.length ? <div className="table-scroll breakfast-table" tabIndex={0} role="region" aria-label="Personas con desayuno">
            <table>
              <thead><tr><th scope="col">Habitación</th><th scope="col">Persona</th><th scope="col">Reserva</th><th scope="col">Estado</th></tr></thead>
              <tbody>
                {guests.map((guest) => <tr key={guest.id}>
                  <td><span className="table-id"><Icon name="bed" size={17} /><strong>{guest.room_name}</strong></span></td>
                  <td><span className="table-id"><Icon name="person" size={17} />{guest.name}</span></td>
                  <td>#{guest.reservation_id} · {guest.holder}</td>
                  <td><span className={`tag ${guest.status}`}>{statusNames[guest.status]}</span></td>
                </tr>)}
              </tbody>
            </table>
          </div> : <p className="quiet-state" role="status">No hay desayunos registrados para esta fecha.</p>}
          <p className="breakfast-help">Cada noche con desayuno se cuenta para la mañana siguiente, incluida la fecha de salida.</p>
        </> : !error && <p className="quiet-state" role="status">Cargando desayunos…</p>}
      </section>
    </>
  );
}
