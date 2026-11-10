import { useEffect, useState } from "react";
import { api, shortDate } from "../lib/api";
import { cents, money } from "../lib/money";
import type { BcbRate } from "../lib/types";

type Props = { onApply: (bolivianos: string) => void };

export function UsdConversion({ onApply }: Props) {
  const [enabled, setEnabled] = useState(false);
  return <div className="form-stack">
    <label className="check-option">
      <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      Convertir tarifa de USD a Bs
    </label>
    {enabled && <Conversion onApply={onApply} />}
  </div>;
}

function Conversion({ onApply }: Props) {
  const [usd, setUsd] = useState("");
  const [result, setResult] = useState<Pick<BcbRate, "quote" | "unavailable" | "lodging_rate"> | null>(null);
  useEffect(() => {
    let active = true;
    void api<BcbRate>("/bcb/usd").then((value) => {
      if (active) setResult(value);
    }).catch(() => {
      if (active) setResult({ quote: null, unavailable: true, lodging_rate: null });
    });
    return () => { active = false; };
  }, []);

  const quote = result?.quote;
  const rate = result?.lodging_rate;
  const official = rate?.source === "bcb" ? quote : null;
  const exchangeRate = rate?.scaled_rate ?? null;
  const converted = exchangeRate !== null && /^\d{1,7}([.,]\d{1,2})?$/.test(usd)
    ? Math.round(cents(usd) * exchangeRate / 10_000) : null;
  return <>
      <div className="row-actions">
        <label>Tarifa por noche (USD)<input inputMode="decimal" value={usd} maxLength={10}
          onChange={(e) => setUsd(e.target.value)} /></label>
        <button type="button" className="button secondary" disabled={!result || converted === null || converted > 100_000_000}
          onClick={() => { if (converted !== null) onApply((converted / 100).toFixed(2)); }}>
          Usar importe en Bs
        </button>
      </div>
      <p className="form-note" role="status">
        {!result ? "Consultando el tipo de cambio oficial del BCB…" : <>
          {official
            ? `${result.unavailable ? "Último dato guardado del BCB" : "Tipo de cambio oficial del BCB"} · Vigente hasta ${shortDate(official.valid_until, true)}.`
            : quote ? `La cotización del BCB venció el ${shortDate(quote.valid_until, true)}.` : "No hay una cotización disponible del BCB."}
          {!official && (rate == null
            ? " Administración puede configurar un tipo de cambio de respaldo."
            : " Se usa el tipo de cambio de respaldo del hostel.")}
          {exchangeRate !== null && ` · 1 USD = ${(exchangeRate / 10_000).toLocaleString("es-BO", { maximumFractionDigits: 4 })} Bs`}
          {converted !== null && ` · Tarifa por noche ${money(converted)}`}
          {converted !== null && converted > 100_000_000 && " · Supera el límite de la tarifa."}
        </>}
      </p>
  </>;
}
