import { useState } from "react";
import { api, today } from "../lib/api";
import { Modal } from "./UI";

type BcbRate = {
  quote: { rate: string; valid_until: string; fetched_at: string } | null;
  source: string;
  unavailable: boolean;
};

export function DollarRate() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<BcbRate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function consult() {
    setBusy(true);
    setError("");
    try {
      setResult(await api<BcbRate>("/bcb/usd"));
    } catch {
      setError("No se pudo consultar la cotización.");
    } finally {
      setBusy(false);
    }
  }

  const quote = result?.quote;
  const expires = quote?.valid_until;
  return <>
    <button type="button" className="button secondary compact"
      onClick={() => { setOpen(true); void consult(); }}>Dólar BCB</button>
    {open && <Modal title="Dólar oficial del BCB" onClose={() => setOpen(false)}>
      <div className="form-stack">
        {quote && <div className="form-note">
          <strong>1 USD = {Number(quote.rate).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} Bs</strong>
          <p>{expires && expires < today() ? "Vigencia vencida" : "Vigente hasta"} · {quote.valid_until}</p>
          <p>Consultado · {new Date(quote.fetched_at).toLocaleString("es-BO", { timeZone: "America/La_Paz" })}</p>
        </div>}
        {busy && <p role="status">Consultando al Banco Central de Bolivia…</p>}
        {!busy && result?.unavailable && <p role="status">
          {quote ? "El BCB no se pudo actualizar. Se muestra el último dato guardado." : "El BCB no está disponible y todavía no hay una cotización guardada."}
        </p>}
        {error && <p role="alert">{error}</p>}
        <div className="row-actions">
          <button type="button" className="button secondary compact" disabled={busy} onClick={() => void consult()}>Consultar de nuevo</button>
          <a href={result?.source ?? "https://www.bcb.gob.bo/index.php"} target="_blank" rel="noreferrer">Ver publicación del BCB</a>
        </div>
      </div>
    </Modal>}
  </>;
}
