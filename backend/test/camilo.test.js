import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/core/database.js";
import { localDay } from "../src/core/charges.js";

test("Camilo cubre hospedaje, separa el estimado de caja y conserva deudas adicionales por huésped", async () => {
  const db = openDatabase(":memory:");
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = "";
  async function request(path, body, method = "POST", session = cookie) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : method,
      headers: { "Content-Type": "application/json", cookie: session },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  try {
    cookie = (await request("/auth/setup", { name: "QA", username: "qa", password: "clave-ficticia-qa" })).cookie;
    await request("/rooms", { name: "Privada", type: "private", capacity: 2 });
    const unit = (await request("/rooms")).body[0].units[0].id;
    const day = localDay();
    const end = new Date(Date.parse(day) + 2 * 86400000).toISOString().slice(0, 10);
    const arrival = await request("/reservations", {
      guest_name: "Huésped Camilo", pax: 2, check_in: day, check_out: end,
      platform_id: 1, status: "confirmed", folio_mode: "individual", nightly_cents: 15001, unit_ids: [unit],
      check_in_payment: { method: "A/C CAMILO", amount_cents: 30002 },
    });
    assert.equal(arrival.status, 201, arrival.body.error);
    const reservationId = arrival.body.id;
    let reservation = (await request("/reservations")).body.find((r) => r.id === reservationId);
    assert.equal(reservation.camilo, 1);
    assert.equal(reservation.folio_balance_cents, 0);
    const folios = (await request("/folios")).body.filter((f) => f.reservation_id === reservationId);
    assert.equal(folios.length, 2);
    for (const folio of folios) {
      const detail = (await request(`/folios/${folio.id}`)).body;
      assert.ok(detail.entries.every((row) => row.balance_cents === 0 && row.camilo_cents === row.total_cents));
    }
    const path = `/folios/${folios[1].id}`;
    const receipt = (await request(path)).body.stay_payments[0];
    assert.equal((await request(`${path}/stay-payments/${receipt.id}/refunds`, { amount_cents: 100, reason: "Sin ingreso real" })).status, 409);
    const monthPath = `/cash/camilo?month=${day.slice(0, 7)}`;
    assert.equal((await request(monthPath, undefined, "GET", "")).status, 401);
    assert.equal((await request("/cash/camilo?month=2026-13")).status, 400);
    assert.equal((await request(monthPath)).body.estimated_cents, 30002);
    assert.equal((await request(monthPath)).body.reservations.length, 1);
    assert.equal((await request(monthPath)).body.reservations[0].accommodation, "Privada");
    assert.ok(!(await request(`/cash/monthly?month=${day.slice(0, 7)}`)).body.some((row) => row.method === "A/C CAMILO"));
    assert.equal((await request("/cash/turns/current")).body.entries.length, 0);
    const extra = await request(path + "/services", { day, service: "Consumo", detail: "Adicional del huésped", total_cents: 700 });
    const payment = { service_id: extra.body.id, day, amount_cents: 700, method: "A/C CAMILO" };
    assert.equal((await request(path + "/payments", payment)).status, 400);
    reservation = (await request("/reservations")).body.find((r) => r.id === reservationId);
    assert.equal(reservation.folio_balance_cents, 700);
    assert.equal(reservation.camilo, 1);
    const extraPayment = await request(path + "/payments", { ...payment, method: "Efectivo" });
    assert.equal(extraPayment.status, 201);
    const ledger = (await request("/cash/daily")).body;
    assert.equal(ledger.find((row) => row.source === "folio" && row.id === extraPayment.body.id).accommodation, "Privada");
    assert.equal((await request("/reservations")).body.find((r) => r.id === reservationId).folio_balance_cents, 0);
    assert.equal((await request(`${path}/payments/${extraPayment.body.id}`, { day, amount_cents: 700, method: "A/C CAMILO" }, "PATCH")).status, 400);
    assert.equal((await request(monthPath)).body.estimated_cents, 30002);
    assert.equal((await request(`${path}/payments/${extraPayment.body.id}/refunds`, { amount_cents: 100, reason: "Ajuste" })).status, 201);
    assert.equal((await request("/cash/daily")).body.find((row) => row.source === "refund").accommodation, "Privada");
    assert.equal((await request("/reservations")).body.find((r) => r.id === reservationId).folio_balance_cents, 100);
    assert.equal((await request(`${path}/stay-payments/${receipt.id}/void`, {})).status, 200);
    assert.equal((await request(monthPath)).body.estimated_cents, 0);
    reservation = (await request("/reservations")).body.find((r) => r.id === reservationId);
    assert.equal(reservation.camilo, 0);
    assert.equal(reservation.folio_balance_cents, 30102);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
