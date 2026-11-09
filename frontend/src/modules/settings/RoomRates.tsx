import { useState, type FormEvent } from "react";
import { ErrorBox } from "../../components/UI";
import { api } from "../../lib/api";
import { cents, money } from "../../lib/money";
import type { Data } from "../../lib/types";

export function RoomRates({
  data,
  onSaved,
}: {
  data: Data;
  onSaved: () => Promise<void>;
}) {
  const [selectedRoom, setSelectedRoom] = useState<number | null>(null);
  const [platform, setPlatform] = useState(1);
  const [pax, setPax] = useState(1);
  const [breakfast, setBreakfast] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rooms = data.rooms.filter((room) => room.active);
  const room = rooms.find((room) => room.id === selectedRoom) ?? rooms[0];
  if (!room) return null;
  const guestRate = platform === 0;
  const current = (guestRate
    ? room.guest_rates.find((rate) => rate.pax === pax && rate.breakfast === breakfast)
    : room.rates.find((rate) => rate.platform_id === platform))?.nightly_cents;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("rate"));
    setBusy(true);
    setError("");
    try {
      await api(
        `/rooms/${room.id}/${guestRate ? "guest-rates" : `rates/${platform}`}`,
        { nightly_cents: value ? cents(value) : null, pax, breakfast },
        "PUT",
      );
      await onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel">
      <h2>Tarifas sugeridas</h2>
      <p className="muted">
        Edita el talonario por habitación, número de personas y desayuno.
        También puedes definir una tarifa base o específica por plataforma.
        El importe corresponde a una noche para todo el grupo.
      </p>
      <ErrorBox message={error} />
      <form className="form-stack" onSubmit={submit}>
        <label>
          Habitación para la tarifa
          <select
            value={room.id}
            disabled={busy}
            onChange={(e) => {
              setSelectedRoom(Number(e.target.value));
              setPax(1);
            }}
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo de tarifa
          <select
            value={platform}
            disabled={busy}
            onChange={(e) => setPlatform(Number(e.target.value))}
          >
            <option value={0}>Talonario · por PAX y desayuno</option>
            {data.platforms
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === 1 ? "Tarifa base · entrada directa" : p.name}
                </option>
              ))}
          </select>
        </label>
        {guestRate && <div className="form-grid">
          <label>Personas
            <select value={pax} disabled={busy} onChange={(e) => setPax(Number(e.target.value))}>
              {Array.from({ length: room.capacity }, (_, index) => index + 1).map((count) => <option key={count}>{count}</option>)}
            </select>
          </label>
          <label>Desayuno
            <select value={breakfast} disabled={busy} onChange={(e) => setBreakfast(Number(e.target.value))}>
              <option value={0}>Sin desayuno</option>
              <option value={1}>Con desayuno</option>
            </select>
          </label>
        </div>}
        <label>
          Tarifa por noche (Bs)
          <input
            key={`${room.id}-${platform}-${pax}-${breakfast}-${current}`}
            name="rate"
            inputMode="decimal"
            pattern="[0-9]{1,7}([.,][0-9]{1,2})?"
            defaultValue={
              current === undefined ? "" : (current / 100).toFixed(2)
            }
            placeholder="Sin tarifa específica"
          />
        </label>
        <small>
          {current === undefined
            ? "Deja el importe vacío para usar la tarifa base o ingresarlo manualmente."
            : `Tarifa guardada · ${money(current)}. Vacía el importe para quitarla.`}
        </small>
        <button className="button primary" disabled={busy}>
          Guardar tarifa
        </button>
      </form>
    </section>
  );
}
