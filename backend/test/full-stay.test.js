import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/core/database.js";
import { localDay } from "../src/core/charges.js";

test("pago completo desde reserva y hoja: saldo por noches, cuentas individuales y un solo movimiento", async () => {
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
    const owner = cookie;
    await request("/users", { name: "Recepción", username: "recepcion", password: "clave-ficticia-qa", role: "receptionist" });
    await request("/rooms", { name: "Privada", type: "private", capacity: 2 });
    await request("/rooms", { name: "Dormitorio", type: "dorm", capacity: 3 });
    const rooms = (await request("/rooms")).body;
    cookie = (await request("/auth/login", { username: "recepcion", password: "clave-ficticia-qa" }, "POST", "")).cookie;
    const day = localDay();
    const draft = { guest_name: "Pago completo", pax: 1, check_in: "2090-01-01", check_out: "2090-01-04",
      platform_id: 2, status: "pending", folio_mode: "shared", nightly_cents: 10001, unit_ids: [rooms[0].units[0].id] };
    const created = await request("/reservations", { ...draft, stay_payment: { method: "QR", amount_cents: 30003 } });
    assert.equal(created.status, 201, created.body.error);
    const reservationPath = `/reservations/${created.body.id}`;
    assert.equal((await request("/reservations")).body.find((r) => r.id === created.body.id).status, "pending");
    const folio = (await request("/folios")).body.find((f) => f.reservation_id === created.body.id);
    const path = `/folios/${folio.id}`;
    let details = (await request(path)).body;
    assert.ok(details.entries.every((row) => row.balance_cents === 0));
    assert.equal(details.stay_payments.length, 1);
    assert.equal(details.stay_payments[0].amount_cents, 30003);
    // Un importe desactualizado revierte también el alta, sin dejar una reserva a medias.
    const count = db.prepare("SELECT COUNT(*) AS n FROM reservations").get().n;
    assert.equal((await request("/reservations", { ...draft, check_in: "2090-02-01", check_out: "2090-02-04",
      stay_payment: { method: "QR", amount_cents: 1 } })).status, 409);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reservations").get().n, count);

    // Cuenta individual: pago parcial previo y servicio adicional no se mezclan con el hospedaje.
    const individual = await request("/reservations", { ...draft, status: "confirmed", pax: 2, folio_mode: "individual",
      unit_ids: rooms[1].units.slice(0, 2).map((u) => u.id) });
    assert.equal(individual.status, 201);
    const sheets = (await request("/folios")).body.filter((f) => f.reservation_id === individual.body.id);
    const individualPath = `/folios/${sheets[0].id}`;
    const otherPath = `/folios/${sheets[1].id}`;
    const otherBefore = (await request(otherPath)).body;
    const service = await request(individualPath + "/services", { day, service: "Lavandería", detail: "Adicional", total_cents: 2000 });
    assert.equal(service.status, 201);
    assert.equal((await request(individualPath + "/payments", { day, lodging_day: draft.check_in, method: "Efectivo", amount_cents: 501 })).status, 201);
    details = (await request(individualPath)).body;
    const due = details.entries.filter((row) => row.lodging_day).reduce((sum, row) => sum + row.balance_cents, 0);
    const payment = { day, method: "Tarjeta", amount_cents: due, expected_balance_cents: due, scope: "folio", full_stay: true };
    assert.equal((await request(individualPath + "/stay-payments", { ...payment, amount_cents: due - 1 })).status, 409);
    const paid = await request(individualPath + "/stay-payments", payment);
    assert.equal(paid.status, 201, paid.body.error);
    assert.equal((await request(individualPath + "/stay-payments", payment)).status, 409);
    details = (await request(individualPath)).body;
    assert.ok(details.entries.filter((row) => row.lodging_day).every((row) => row.balance_cents === 0));
    assert.equal(details.entries.find((row) => row.service_id === service.body.id).balance_cents, 2000);
    assert.deepEqual((await request(otherPath)).body, otherBefore);
    const ledger = (await request("/cash/turns/current")).body.entries.filter((row) => row.source === "stay" && row.id === paid.body.id);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].base_cents, due);
    assert.equal(ledger[0].surcharge_cents, Math.floor((due * 5 + 50) / 100));
    assert.equal((await request(individualPath + `/stay-payments/${paid.body.id}`, { day, method: "QR", amount_cents: due - 100 }, "PATCH")).status, 403);
    // La corrección autorizada conserva la hoja destinataria del pago completo.
    assert.equal((await request(individualPath + `/stay-payments/${paid.body.id}`, { day, method: "QR", amount_cents: due - 100 }, "PATCH", owner)).status, 200);
    assert.deepEqual((await request(otherPath)).body, otherBefore);

    // Pagar al salir liquida el saldo de todas las hojas y registra la salida en la misma transacción.
    const route = `/reservations/${individual.body.id}/operation`;
    assert.equal((await request(route, { status: "in_house" })).status, 200);
    const current = (await request("/reservations")).body.find((r) => r.id === individual.body.id);
    const remaining = 30003 - current.lodging_paid_cents;
    assert.equal((await request(route, { status: "checked_out", stay_payment: { method: "Efectivo", amount_cents: remaining - 1 } })).status, 409);
    assert.equal((await request("/reservations")).body.find((r) => r.id === individual.body.id).status, "in_house");
    assert.equal((await request(route, { status: "checked_out", stay_payment: { method: "Efectivo", amount_cents: remaining } })).status, 200);
    for (const sheet of sheets) assert.ok((await request(`/folios/${sheet.id}`)).body.entries.filter((row) => row.lodging_day).every((row) => row.balance_cents === 0));
    assert.equal((await request(individualPath)).body.entries.find((row) => row.service_id === service.body.id).balance_cents, 2000);
    assert.equal((await request(reservationPath + "/operation", { status: "cancelled", stay_payment: { method: "QR", amount_cents: 1 } })).status, 409);
    const camilo = await request("/reservations", { ...draft, check_in: "2090-03-01", check_out: "2090-03-04",
      stay_payment: { method: "A/C CAMILO", amount_cents: 30003 } });
    assert.equal(camilo.status, 201, camilo.body.error);
    assert.equal((await request("/cash/camilo?month=" + day.slice(0, 7))).body.estimated_cents, 30003);
    assert.ok(!(await request("/cash/turns/current")).body.entries.some((row) => row.method === "A/C CAMILO"));
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
