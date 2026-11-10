import { useState } from "react";
import { api, localDateTime, shortDate, today } from "../lib/api";
import type { BcbRate } from "../lib/types";
import { Icon, Modal } from "./UI";

export function DollarRate() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<BcbRate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function consult() {
    setBusy(true);
    setError("");
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
  const expired = !!quote && quote.valid_until < today();
  return <>
    <button type="button" className="button secondary compact"
      onClick={() => { setOpen(true); void consult(); }}>Dólar BCB</button>
    {open && <Modal title="Dólar oficial del BCB" onClose={() => setOpen(false)}>
      <div className="form-stack">
        {quote && <>
          <div className="bcb-quote">
            <div className="bcb-quote-label"><Icon name="cash" /> Tipo de cambio oficial</div>
            <p className="bcb-quote-value">
              <strong>Bs {Number(quote.rate).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</strong>
              <span>por 1 dólar estadounidense</span>
            </p>
            <span className={expired ? "bcb-badge expired" : "bcb-badge"}>
              {expired ? "Vigencia vencida" : "Vigente"}{result?.unavailable && " · Dato guardado"}
            </span>
          </div>
          <dl className="bcb-metadata">
            <div><dt>{expired ? "Venció el" : "Vigente hasta"}</dt><dd>{shortDate(quote.valid_until, true)}</dd></div>
            <div><dt>Última consulta exitosa</dt><dd>{localDateTime(quote.fetched_at)}</dd></div>
          </dl>
        </>}
        {busy && <p role="status">Consultando al Banco Central de Bolivia…</p>}
        {!busy && result?.unavailable && <p className="form-note" role="status">
          {quote ? "El BCB no se pudo actualizar. Se muestra el último dato guardado." : "El BCB no está disponible y todavía no hay una cotización guardada."}
        </p>}
        {error && <p role="alert">{error}</p>}
        <div className="row-actions">
          <button type="button" className="button primary compact" disabled={busy} onClick={() => void consult()}>Consultar de nuevo</button>
          <a className="text-button" href={result?.source ?? "https://www.bcb.gob.bo/index.php"} target="_blank" rel="noreferrer">Ver publicación del BCB</a>
        </div>
      </div>
    </Modal>}
  </>;
}
