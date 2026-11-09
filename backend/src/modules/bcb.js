import { date } from "../core/validation.js";

const source = "https://www.bcb.gob.bo/index.php";

export function readOfficialRate(html) {
  const card = html.match(/<article\b[^>]*class="[^"]*\bis-tc-oficial\b[^"]*"[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const rate = card?.match(/<span\b[^>]*class="[^"]*\bbcb-tco-num\b[^"]*"[^>]*>\s*(\d{1,3}[,.]\d{2,4})\s*<\/span>/i)?.[1];
  const until = card?.match(/<time\b[^>]*datetime="(\d{4}-\d{2}-\d{2})"/i)?.[1];
  if (!rate || !until || Number(rate.replace(",", ".")) <= 0)
    throw new Error("No se reconoció el tipo de cambio oficial en el BCB.");
  return { rate: rate.replace(",", "."), valid_until: date(until) };
}

export function bcbRateHandler(db, request = fetch) {
  const saved = db.prepare("SELECT rate,valid_until,fetched_at FROM bcb_usd_rate WHERE id=1");
  const save = db.prepare(`INSERT INTO bcb_usd_rate(id,rate,valid_until,fetched_at) VALUES(1,?,?,?)
    ON CONFLICT(id) DO UPDATE SET rate=excluded.rate,valid_until=excluded.valid_until,
      fetched_at=excluded.fetched_at WHERE excluded.valid_until>=bcb_usd_rate.valid_until`);
  let pending;
  let retryAfter = 0;
  let unavailable = false;

  async function refresh() {
    try {
      const response = await request(source, {
        signal: AbortSignal.timeout(6000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("El BCB no respondió.");
      const quote = readOfficialRate(await response.text());
      unavailable = !save.run(quote.rate, quote.valid_until, new Date().toISOString()).changes;
    } catch {
      unavailable = true;
    } finally {
      retryAfter = Date.now() + (unavailable ? 60_000 : 300_000);
    }
  }

  return async (req, res) => {
    if (pending) await pending;
    else if (Date.now() >= retryAfter) {
      pending = refresh().finally(() => { pending = null; });
      await pending;
    }
    res.json({ quote: saved.get() ?? null, source, unavailable });
  };
}
