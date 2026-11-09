import { DayPicker } from "react-day-picker";
import { es } from "react-day-picker/locale";
import "react-day-picker/style.css";
import { addDays, daysBetween, shortDate, today } from "../../lib/api";

const localDate = (day: string) => new Date(`${day}T12:00:00`);
function iso(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function StayDates({
  start,
  end,
  onChange,
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}) {
  return (
    <fieldset className="stay-picker">
      <legend>Fechas de la estadía</legend>
      <div className="stay-summary" aria-live="polite">
        <span>
          Entrada <strong>{shortDate(start)}</strong>
        </span>
        <span>
          Salida <strong>{end ? shortDate(end) : "Por elegir"}</strong>
        </span>
        <span>
          Noches <strong>{end ? daysBetween(start, end) : "—"}</strong>
        </span>
      </div>
      <DayPicker
        mode="range"
        locale={es}
        today={localDate(today())}
        defaultMonth={localDate(start)}
        selected={{
          from: localDate(start),
          to: end ? localDate(end) : undefined,
        }}
        resetOnSelect
        min={1}
        max={366}
        onSelect={(range) => {
          if (range?.from)
            onChange(iso(range.from), range.to ? iso(range.to) : "");
        }}
      />
      <p className="muted small">
        {end
          ? `Última noche: ${shortDate(addDays(end, -1))}. La salida queda libre.`
          : "Selecciona el día de salida en el calendario."}
      </p>
    </fieldset>
  );
}
