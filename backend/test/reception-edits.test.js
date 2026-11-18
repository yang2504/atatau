import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/core/database.js";
import { localDay } from "../src/core/charges.js";

test("recepción y administración editan y cancelan sin borrar el historial ni omitir disponibilidad", async () => {
  const db = openDatabase(":memory:");
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = "";
  async function request(path, body, method = "POST", session = cookie) {
    const response = await fetch(base + path, { method: body === undefined ? "GET" : method,
      headers: { "Content-Type": "application/json", cookie: session },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  try {
    cookie = (await request("/auth/setup", { name: "QA", username: "qa", password: "clave-ficticia-qa" })).cookie;
    for (const role of ["receptionist", "admin"]) await request("/users", { name: role, username: role, role, password: "clave-ficticia-qa" });
    await request("/rooms", { name: "Privada QA", type: "private", capacity: 2 });
    const unit = (await request("/rooms")).body[0].units[0].id;
    for (const [index, role] of ["receptionist", "admin"].entries()) {
      cookie = (await request("/auth/login", { username: role, password: "clave-ficticia-qa" }, "POST", "")).cookie;
      const month = `2090-0${index + 5}`;
      const original = { guest_name: "Huésped QA", pax: 1, check_in: month + "-01", check_out: month + "-03",
        platform_id: 2, status: "confirmed", folio_mode: "shared", nightly_cents: 10000, unit_ids: [unit] };
      const created = await request("/reservations", original);
      assert.equal(created.status, 201);
      const path = `/reservations/${created.body.id}`;
      const updated = { ...original, guest_name: "Huésped corregido", check_in: month + "-04", check_out: month + "-06",
        arrival_time: "18:35", nightly_cents: 12000, comments: "Cambio desde recepción" };
      assert.equal((await request(path, updated, "PUT")).status, 200);
      let saved = (await request("/reservations")).body.find((row) => row.id === created.body.id);
      for (const key of ["guest_name", "check_in", "check_out", "arrival_time", "nightly_cents", "comments"]) assert.equal(saved[key], updated[key]);
      const folio = (await request("/folios")).body.find((row) => row.reservation_id === created.body.id);
      const folioPath = `/folios/${folio.id}`;
      const busy = await request("/reservations", { ...original, check_in: month + "-08", check_out: month + "-10" });
      assert.equal((await request(path, { ...updated, check_in: month + "-08", check_out: month + "-10" }, "PUT")).status, 409);
      assert.equal((await request(path, { ...updated, status: "cancelled" }, "PUT")).status, 200);
      assert.equal(db.prepare("SELECT status FROM reservations WHERE id=?").get(created.body.id).status, "cancelled");
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guests WHERE reservation_id=?").get(created.body.id).n, 1);
      assert.equal((await request(folioPath)).status, 200);
      const replacement = await request("/reservations", updated);
      assert.equal(replacement.status, 201, replacement.body.error);
      assert.equal((await request(path, updated, "PUT")).status, 409);
      assert.equal((await request(`/reservations/${replacement.body.id}`, { ...updated, status: "cancelled" }, "PUT")).status, 200);
      assert.equal((await request(path, updated, "PUT")).status, 200);
      assert.equal((await request(path, {}, "DELETE")).status, 404);
      assert.ok(db.prepare("SELECT id FROM reservations WHERE id=?").get(created.body.id));
      assert.ok(db.prepare("SELECT id FROM reservations WHERE id=?").get(busy.body.id));
      const day = localDay();
      const payment = await request(folioPath + "/payments", { day, lodging_day: updated.check_in, method: "Efectivo", amount_cents: 500 });
      assert.equal((await request(folioPath + `/payments/${payment.body.id}`, { day, method: "QR", amount_cents: 500 }, "PATCH")).status, 200);
      assert.equal((await request(folioPath + `/payments/${payment.body.id}/void`, {})).status, 200);
      assert.equal(db.prepare("SELECT voided FROM folio_payments WHERE id=?").get(payment.body.id).voided, 1);
      assert.equal((await request(folioPath + "/lodging-rate", { start: updated.check_in, end: updated.check_out,
        nightly_cents: 13000, expected_base: 12000, expected_rates: {} }, "PATCH")).status, 200);
      const cash = { day, detail: "Egreso QA", kind: "expense", method: "Efectivo", base_cents: 1000 };
      const entry = await request("/cash", cash);
      assert.equal((await request(`/cash/${entry.body.id}`, { ...cash, detail: "Egreso corregido", base_cents: 900 }, "PATCH")).status, 200);
      assert.equal((await request(`/cash/${entry.body.id}/void`, {})).status, 200);
      assert.equal(db.prepare("SELECT voided FROM cash_entries WHERE id=?").get(entry.body.id).voided, 1);
    }
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
