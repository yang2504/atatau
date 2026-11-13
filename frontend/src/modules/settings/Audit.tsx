import { useEffect, useState } from "react";
import { ErrorBox } from "../../components/UI";
import { api, localDateTime, statusNames } from "../../lib/api";
import { money } from "../../lib/money";

type Value = null | string | number | Value[] | { [key: string]: Value };
type Event = {
  id: number;
  author: string;
  created_at: string;
  action: string;
  entity: string;
  entity_id: number;
  before: Value;
  after: Value;
};

const actions: Record<string, string> = {
  create: "Creación", update: "Edición", check_in: "Llegada", check_out: "Salida",
  cancel: "Cancelación", extend: "Extensión", add_guest: "Huésped incorporado",
  move_room: "Cambio de habitación", lodging_rate: "Ajuste de tarifa", void: "Anulación",
  replace: "Corrección de abono", create_stay_payment: "Cobro de estadía", refund: "Reembolso", delete: "Retiro",
};
const entities: Record<string, string> = {
  reservation: "Reserva", folio: "Hoja", folio_service: "Consumo", folio_payment: "Abono",
  cash_entry: "Movimiento de caja", pop_movement: "Movimiento Pub", lodging_exchange_rate: "Tipo de cambio",
  shift_schedule: "Horario semanal", folio_refund: "Reembolso de hoja",
};
const fields: Record<string, string> = {
  id: "ID", check_in: "Entrada", check_out: "Salida", guest_name: "Titular", pax: "PAX",
  status: "Estado", units: "Habitación y camas", unit_id: "Unidad", room_id: "ID habitación",
  room_name: "Habitación", label: "Unidad", nightly_cents: "Tarifa por noche", night_rates: "Tarifas por fecha",
  guests: "Huéspedes", added_guests: "Huéspedes incorporados", joined_on: "Fecha de incorporación", folios: "Hojas", name: "Nombre", title: "Titular de la hoja",
  moves: "Traslados",
  created_at: "Registro", checked_in_at: "Llegada registrada", platform_id: "Canal",
  folio_mode: "Modalidad", folio_holder: "Encargado de la cuenta", comments: "Observaciones",
  breakfast: "Desayuno", arrival_time: "Hora prevista de llegada",
  folio_id: "Hoja", reservation_id: "Reserva", guest_id: "Huésped", service_id: "Consumo",
  lodging_day: "Noche", day: "Fecha", service: "Servicio", detail: "Detalle", method: "Medio de pago",
  total_cents: "Total", amount_cents: "Abono", base_cents: "Importe base",
  surcharge_cents: "Recargo", voided: "Anulado", group_id: "Cobro de estadía", applications: "Distribución por hoja",
  cash_box: "Caja", turn_id: "Turno", kind: "Tipo de movimiento",
  quantity: "Cantidad", stock: "Stock", product_id: "Producto", scaled_rate: "Bs por USD",
};

function Snapshot({ value, field = "" }: { value: Value; field?: string }) {
  if (value === null || value === "") return <>—</>;
  if (Array.isArray(value)) return value.length
    ? <ul>{value.map((item, index) => <li key={index}><Snapshot value={item} /></li>)}</ul>
    : <>—</>;
  if (typeof value === "object") return Object.keys(value).length
    ? <dl>{Object.entries(value).map(([key, item]) => <div key={key}>
        <dt>{fields[key] ?? key}</dt><dd><Snapshot value={item} field={field === "night_rates" ? "nightly_cents" : key} /></dd>
      </div>)}</dl>
    : <>—</>;
  if (typeof value === "number" && field.endsWith("_cents")) return <>{money(value)}</>;
  if (field === "status") return <>{statusNames[value] ?? value}</>;
  if (field.endsWith("_at")) return <>{localDateTime(String(value))}</>;
  if (field === "scaled_rate") return <>{Number(value) / 10_000}</>;
  if (field === "voided" || field === "breakfast") return <>{value ? "Sí" : "No"}</>;
  const labels: Record<string, string> = {
    petty: "Caja Chica", pub: "Caja Pub", income: "Ingreso", expense: "Egreso",
    sale: "Venta", in: "Entrada de stock", out: "Baja de stock",
    shared: "Conjunta", individual: "Individual",
  };
  return <>{["cash_box", "kind", "folio_mode"].includes(field) ? labels[value] ?? value : value}</>;
}

export function Audit() {
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState("");
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(true);
  async function load(before?: number) {
    setBusy(true);
    setError("");
    try {
      const page = await api<Event[]>(`/audit${before ? `?before=${before}` : ""}`);
      setEvents((current) => before ? [...current, ...page] : page);
      setMore(page.length === 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { void load(); }, []);
  return <section className="panel settings-panel audit-panel">
    <h2>Historial de operaciones</h2>
    <ErrorBox message={error} />
    {busy && !events.length && <p role="status">Cargando historial…</p>}
    {!busy && !error && !events.length && <p>Aún no hay operaciones registradas.</p>}
    {events.map((event) => <details className="audit-event" key={event.id}>
      <summary>
        <strong>{actions[event.action] ?? event.action} · {entities[event.entity]} #{event.entity_id}</strong>
        <span>{event.author} · {localDateTime(event.created_at)}</span>
      </summary>
      {event.before === null && event.after === null ? <p>Registro histórico sin detalle de valores.</p> :
        <div className="form-grid audit-values">
          <section><h3>Valor anterior</h3><Snapshot value={event.before} /></section>
          <section><h3>Valor nuevo</h3><Snapshot value={event.after} /></section>
        </div>}
    </details>)}
    {more && <button className="button secondary" disabled={busy} onClick={() => void load(events.at(-1)?.id)}>
      {events.length ? "Ver operaciones anteriores" : "Cargar historial"}
    </button>}
  </section>;
}
