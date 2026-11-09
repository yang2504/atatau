import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/core/database.js";
import { bcbRateHandler, readOfficialRate } from "../src/modules/bcb.js";

const official = `<article class="bcb-kpi2-card is-tc-oficial has-range-label">
  <time datetime="2026-11-09">Vigente hasta el 9</time>
  <span class="bcb-tco-num">11,81</span>
</article>`;

async function lookup(handler) {
  let result;
  await handler({}, { json(value) { result = value; } });
  return result;
}

test("consulta el TCO del BCB y conserva la última cotización cuando falla la fuente", async () => {
  const db = openDatabase(":memory:");
  try {
    assert.throws(() => readOfficialRate(official.replace("is-tc-oficial", "is-referencial")));
    assert.throws(() => readOfficialRate(official.replace("2026-11-09", "2026-02-30")));
    const offline = async () => { throw new Error("sin internet"); };
    const empty = await lookup(bcbRateHandler(db, offline));
    assert.equal(empty.quote, null);
    assert.equal(empty.unavailable, true);

    let requests = 0;
    const online = bcbRateHandler(db, async () => {
      requests++;
      return new Response(official);
    });
    const [first, second] = await Promise.all([lookup(online), lookup(online)]);
    assert.equal(requests, 1);
    assert.deepEqual(first, second);
    assert.equal(first.quote.rate, "11.81");
    assert.equal(first.quote.valid_until, "2026-11-09");
    assert.equal(first.unavailable, false);
    assert.deepEqual(await lookup(online), first);
    assert.equal(requests, 1);

    const malformed = await lookup(bcbRateHandler(db, async () => new Response("Página sin cotización")));
    assert.deepEqual(malformed.quote, first.quote);
    assert.equal(malformed.unavailable, true);
    const older = await lookup(bcbRateHandler(db, async () => new Response(official.replace("2026-11-09", "2026-11-06"))));
    assert.deepEqual(older.quote, first.quote);
    assert.equal(older.unavailable, true);
  } finally {
    db.close();
  }
});
