import { useEffect, useState } from "react";
import { ErrorBox } from "../../components/UI";
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
    <section className="panel">
      <div className="section-toolbar">
        <h2>Reporte diario de desayunos</h2>
        <div className="row-actions">
          <button type="button" className="button secondary compact" aria-label="Día anterior" onClick={() => setDay(addDays(day, -1))}>‹</button>
          <button type="button" className="button secondary compact" onClick={() => setDay(today())}>Hoy</button>
          <input type="date" aria-label="Fecha del desayuno" value={day} onChange={(e) => { if (e.target.value) setDay(e.target.value); }} />
          <button type="button" className="button secondary compact" aria-label="Día siguiente" onClick={() => setDay(addDays(day, 1))}>›</button>
        </div>
      </div>
      <ErrorBox message={error} />
      {guests ? <>
        <div className="ledger-totals">
          <span>Desayunos confirmados <strong>{guests.length - pending}</strong></span>
          <span>Por confirmar <strong>{pending}</strong></span>
        </div>
        <p className="quiet-state">Cada noche con desayuno se cuenta para la mañana siguiente, incluida la fecha de salida.</p>
        {guests.length ? <div className="table-scroll">
          <table>
            <thead><tr><th>Persona</th><th>Habitación</th><th>Reserva</th><th>Estado</th></tr></thead>
            <tbody>
              {guests.map((guest) => <tr key={guest.id}>
                <td><strong>{guest.name}</strong></td>
                <td>{guest.room_name}</td>
                <td>#{guest.reservation_id} · {guest.holder}</td>
                <td><span className={`tag ${guest.status}`}>{statusNames[guest.status]}</span></td>
              </tr>)}
            </tbody>
          </table>
        </div> : <p className="quiet-state">No hay desayunos registrados para esta fecha.</p>}
      </> : !error && <p className="quiet-state" role="status">Cargando desayunos…</p>}
    </section>
  );
}
