import { Icon } from "./UI";
import { cardSurcharge, money } from "../lib/money";

export function CardCharge({ base }: { base: number }) {
  const fee = cardSurcharge(base);
  return (
    <div className="form-note card-charge">
      <Icon name="card" size={19} />
      <div>
        <strong>Total con tarjeta {money(base + fee)}</strong>
        <small>En caja {money(base)} · Comisión descontada {money(fee)} (5 %)</small>
      </div>
    </div>
  );
}
