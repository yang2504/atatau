import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/core/database.js";
import { localDay } from "../src/core/charges.js";

test("reservas, permisos y persistencia transaccional", async () => {
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
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  try {
    assert.equal((await request("/rooms")).status, 401);
    assert.equal((await request("/auth/setup", [])).status, 400);
    const setup = await request("/auth/setup", {
      name: "Prueba",
      username: "owner",
      password: "clave-segura-prueba",
    });
    assert.equal(setup.status, 200);
    cookie = setup.cookie;
    assert.equal(
      (
        await request("/auth/setup", {
          name: "Otro",
          username: "otro",
          password: "clave-segura-prueba",
        })
      ).status,
      409,
    );
    const room = await request("/rooms", {
      name: "Matrimonial",
      type: "private",
      capacity: 2,
    });
    const dorm = await request("/rooms", {
      name: "Dormitorio",
      type: "dorm",
      capacity: 6,
    });
    assert.equal(room.status, 201);
    assert.equal(dorm.status, 201);
    const rooms = (await request("/rooms")).body;
    assert.equal(rooms[1].units.length, 6);
    const draft = {
      guest_name: "Juan",
      pax: 2,
      check_in: "2026-11-01",
      check_out: "2026-11-05",
      platform_id: 2,
      status: "confirmed",
      folio_mode: "shared",
      nightly_cents: 15001,
      unit_ids: [rooms[0].units[0].id],
    };
    const first = await request("/reservations", draft);
    assert.equal(first.status, 201);
    assert.equal((await request("/folios")).body.length, 1);
    const folio = (await request("/folios")).body[0];
    const path = `/folios/${folio.id}`;
    assert.equal((await request(path)).body.entries.length, 4);
    const payment = {
      lodging_day: draft.check_in,
      day: draft.check_in,
      method: "QR",
      amount_cents: 5000,
    };
    const qr = await request(path + "/payments", payment);
    assert.equal(qr.status, 201);
    assert.equal(qr.body.collected_cents, 5000);
    assert.equal(qr.body.surcharge_cents, 0);
    assert.equal((await request(path)).body.entries[0].balance_cents, 10001);
    assert.deepEqual((await request("/reservations")).body[0].paid_nights, []);
    assert.equal(
      (await request(path + "/payments", { ...payment, amount_cents: 10002 }))
        .status,
      409,
    );
    const remainder = await request(path + "/payments", {
      ...payment,
      amount_cents: 10001,
      method: "Tarjeta",
    });
    assert.equal(remainder.status, 201);
    assert.equal(remainder.body.collected_cents, 10501);
    assert.equal(remainder.body.cash_cents, 10001);
    assert.deepEqual((await request("/reservations")).body[0].paid_nights, [
      draft.check_in,
    ]);
    assert.equal(
      (
        await request(
          `/reservations/${first.body.id}`,
          { ...draft, nightly_cents: 16000 },
          "PUT",
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          `/reservations/${first.body.id}`,
          { ...draft, check_in: "2026-11-02" },
          "PUT",
        )
      ).status,
      409,
    );
    assert.equal(
      (await request(path + `/payments/${remainder.body.id}/void`, {})).status,
      200,
    );
    assert.deepEqual((await request("/reservations")).body[0].paid_nights, []);
    const service = await request(path + "/services", {
      day: draft.check_in,
      service: "Lavandería",
      detail: "Una carga",
      total_cents: 2500,
    });
    assert.equal(service.status, 201);
    assert.equal(
      (
        await request(path + "/payments", {
          service_id: service.body.id,
          day: draft.check_in,
          method: "Efectivo",
          amount_cents: 2500,
        })
      ).status,
      201,
    );
    assert.equal(
      (await request(path)).body.entries.find(
        (row) => row.service_id === service.body.id,
      ).balance_cents,
      0,
    );
    assert.equal(
      (
        await request(
          `/rooms/${room.body.id}/rates/2`,
          { nightly_cents: 16000 },
          "PUT",
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("/rooms")).body[0].rates[0].nightly_cents,
      16000,
    );
    assert.equal((await request("/reservations")).body[0].nightly_cents, 15001);
    assert.equal(db.prepare("SELECT count(*) AS n FROM guests").get().n, 2);
    assert.equal(
      (
        await request("/reservations", {
          ...draft,
          guest_name: "No cabe",
          pax: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("/reservations", {
          ...draft,
          check_in: "2026-11-05",
          check_out: "2026-11-06",
          status: "pending",
        })
      ).status,
      201,
    );
    assert.equal((await request("/reservations")).body[1].status, "pending");
    assert.equal((await request("/reservations", {
      ...draft, check_in: "2026-11-05", check_out: "2026-11-06",
    })).status, 409, "las reservas pendientes apartan disponibilidad");
    assert.equal((await request(`/rooms/${room.body.id}/guest-rates`, {
      pax: 2, breakfast: 1, nightly_cents: 28000,
    }, "PUT")).status, 200);
    assert.equal((await request("/rooms")).body[0].guest_rates[0].nightly_cents, 28000);
    assert.equal(
      (
        await request("/reservations", {
          ...draft,
          check_in: "2026-02-30",
          check_out: "2026-03-05",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/reservations", {
          ...draft,
          check_in: "2026-11-08",
          check_out: "2026-11-07",
        })
      ).status,
      400,
    );
    assert.equal(
      (await request("/reservations", { ...draft, pax: 3 })).status,
      400,
    );
    const before = db.prepare("SELECT count(*) AS n FROM reservations").get().n;
    const individual = {
      ...draft,
      guest_name: "Ana",
      breakfast: 1,
      folio_mode: "individual",
      unit_ids: rooms[1].units.slice(0, 2).map((u) => u.id),
    };
    assert.equal(
      (
        await request("/reservations", {
          ...individual,
          guest_names: ["Ana", "x".repeat(101)],
        })
      ).status,
      400,
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM reservations").get().n,
      before,
      "rollback de reserva, huéspedes y hojas",
    );
    const group = await request("/reservations", individual);
    assert.equal(group.status, 201);
    assert.deepEqual((await request("/reservations/breakfast?day=2026-11-01")).body, []);
    for (const day of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]) {
      const breakfast = await request(`/reservations/breakfast?day=${day}`);
      assert.deepEqual(breakfast.body.map((guest) => guest.name), ["Ana", "Acompañante 2"]);
    }
    assert.deepEqual((await request("/reservations/breakfast?day=2026-11-06")).body, []);
    assert.equal((await request("/reservations/breakfast?day=2026-02-30")).status, 400);
    const folios = (await request("/folios")).body;
    assert.equal(folios.length, 4);
    const accounts = folios.filter((f) => f.reservation_id === group.body.id);
    for (const [index, account] of accounts.entries()) {
      const accountPath = `/folios/${account.id}`;
      const row = (await request(accountPath)).body.entries[0];
      assert.equal(row.total_cents, index === 0 ? 7500 : 7501);
      assert.equal(
        (
          await request(accountPath + "/payments", {
            ...payment,
            amount_cents: row.total_cents,
          })
        ).status,
        201,
      );
      const updated = (await request("/reservations")).body.find(
        (r) => r.id === group.body.id,
      );
      assert.deepEqual(
        updated.paid_nights,
        index === 0 ? [] : [draft.check_in],
      );
    }
    assert.equal(
      (await request("/reservations", { ...individual, pax: 3 })).status,
      400,
    );
    const beforeEdit = (await request("/folios")).body.length;
    assert.equal(
      (
        await request(
          `/reservations/${first.body.id}`,
          { ...draft, guest_name: "Juan Pérez" },
          "PUT",
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("/folios")).body.length,
      beforeEdit,
      "editar no duplica hojas",
    );
    assert.equal(
      (
        await request(
          `/reservations/${first.body.id}`,
          { ...draft, pax: 1 },
          "PUT",
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          `/rooms/${room.body.id}`,
          { name: "Matrimonial", active: 0 },
          "PATCH",
        )
      ).status,
      409,
    );
    assert.equal(
      (await request("/platforms/2", { active: 0 }, "PATCH")).status,
      200,
    );
    assert.equal(
      (
        await request("/reservations", {
          ...draft,
          check_in: "2026-12-01",
          check_out: "2026-12-02",
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(`/reservations/${first.body.id}`, draft, "PUT")).status,
      200,
      "permite mantener plataforma histórica",
    );
    assert.equal(
      (await request("/platforms/1", { active: 0 }, "PATCH")).status,
      400,
    );
    const receptionist = await request("/users", {
      name: "Recepción",
      username: "recepcion",
      password: "clave-de-recepcion",
      role: "receptionist",
    });
    assert.equal(receptionist.status, 201);
    const receptionLogin = await request("/auth/login", {
      username: "recepcion",
      password: "clave-de-recepcion",
    });
    assert.equal(receptionLogin.status, 200);
    const firstPath = `/reservations/${first.body.id}`;
    const arrived = { ...draft, status: "in_house", checked_in_by: setup.body.id };
    assert.equal((await request(firstPath, arrived, "PUT", receptionLogin.cookie)).status, 200);
    const arrivalRecord = (await request("/reservations")).body.find((row) => row.id === first.body.id);
    assert.equal(arrivalRecord.checked_in_by, receptionist.body.id);
    assert.equal(arrivalRecord.checked_in_by_name, "Recepción");
    assert.ok(Number.isFinite(Date.parse(arrivalRecord.checked_in_at)));
    assert.equal((await request(firstPath, { ...arrived, comments: "Llegada registrada" }, "PUT")).status, 200);
    const editedArrival = (await request("/reservations")).body.find((row) => row.id === first.body.id);
    assert.equal(editedArrival.checked_in_by, arrivalRecord.checked_in_by);
    assert.equal(editedArrival.checked_in_at, arrivalRecord.checked_in_at);
    assert.equal(
      (
        await request(
          "/rooms",
          { name: "No permitido", type: "dorm", capacity: 2 },
          "POST",
          receptionLogin.cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/users", undefined, "GET", receptionLogin.cookie)).status,
      403,
    );
    const note = await request(
      "/notes",
      {
        body: "Juan espera lavandería",
        category: "guest",
        room_id: room.body.id,
        reservation_id: first.body.id,
        amount_cents: 1250,
      },
      "POST",
      receptionLogin.cookie,
    );
    assert.equal(note.status, 201);
    assert.equal(
      (
        await request(
          `/notes/${note.body.id}`,
          { resolved: 1 },
          "PATCH",
          receptionLogin.cookie,
        )
      ).status,
      200,
    );
    assert.equal((await request("/notes")).body[0].resolved, 1);
    const profile = await request(`/users/${receptionist.body.id}`, {
      name: "Recepción turno tarde", chat_color: "#526879",
    }, "PATCH");
    assert.equal(profile.body.user.chat_color, "#526879");
    const reply = await request("/notes", {
      body: "Lavandería entregada", category: "handover", reply_to: note.body.id,
    });
    assert.equal(reply.status, 201);
    const messages = (await request("/notes")).body;
    assert.equal(messages[0].reply_preview, "Juan espera lavandería");
    assert.equal(messages[1].chat_color, "#526879");
    assert.equal((await request(`/users/${receptionist.body.id}`, {
      name: "No permitido",
    }, "PATCH", receptionLogin.cookie)).status, 403);

    const today = localDay();
    const manual = { day: today, kind: "income", detail: "Ingreso extra", method: "Tarjeta", base_cents: 1000 };
    const manualCard = await request("/cash", manual, "POST", receptionLogin.cookie);
    assert.equal(manualCard.body.collected_cents, 1050);
    assert.equal(manualCard.body.cash_cents, 1000);
    assert.equal((await request("/cash", { ...manual, method: "QR" })).body.collected_cents, 1000);
    assert.equal((await request("/cash", { ...manual, day: "2000-01-01" }, "POST", receptionLogin.cookie)).status, 403);
    const expense = { ...manual, kind: "expense", detail: "Insumos" };
    assert.equal((await request("/cash", expense, "POST", receptionLogin.cookie)).status, 403);
    assert.equal((await request("/cash", expense)).body.collected_cents, 1000);
    const monthPath = `/cash/monthly?month=${today.slice(0, 7)}`;
    assert.equal((await request(monthPath, undefined, "GET", receptionLogin.cookie)).status, 403);
    assert.ok((await request(monthPath)).body.some((row) => row.kind === "expense"));
    // Simulate a surcharge saved under the previous rule.
    db.prepare("UPDATE folio_payments SET surcharge_cents=250 WHERE id=?").run(qr.body.id);
    const historic = (await request("/cash/monthly?month=2026-11")).body;
    assert.ok(historic.some((row) => row.source === "folio" && row.id === qr.body.id
      && row.surcharge_cents === 250 && row.cash_cents === 5000));
    assert.ok(historic.some((row) => row.source === "folio" && row.id === remainder.body.id && row.voided === 1));

    const product = await request("/pub", { name: "Powerade", price_cents: 1500 });
    assert.equal(product.status, 201);
    const movements = `/pop/${product.body.id}/movements`;
    const arrival = { kind: "in", quantity: 2, detail: "Reposición" };
    assert.equal((await request(movements, arrival, "POST", receptionLogin.cookie)).status, 403);
    assert.equal((await request(movements, arrival)).body.stock, 2);
    const sale = { kind: "sale", quantity: 2, method: "Tarjeta", base_cents: 3000 };
    assert.equal((await request(movements, { ...sale, base_cents: 100 }, "POST", receptionLogin.cookie)).status, 409);
    assert.equal((await request(movements, sale, "POST", receptionLogin.cookie)).body.collected_cents, 3150);
    assert.equal((await request(movements, sale, "POST", receptionLogin.cookie)).status, 409);
    assert.equal((await request("/pop")).body[0].stock, 0);
    const daily = (await request("/cash/daily", undefined, "GET", receptionLogin.cookie)).body;
    const pubDaily = (await request("/cash/daily?box=pub", undefined, "GET", receptionLogin.cookie)).body;
    assert.ok(pubDaily.some((row) => row.source === "pop" && row.surcharge_cents === 150 && row.cash_cents === 3000));
    assert.ok(daily.every((row) => row.cash_box === "petty" && row.source !== "pop"));
    assert.ok(daily.some((row) => row.source === "manual" && row.id === manualCard.body.id
      && row.surcharge_cents === 50 && row.cash_cents === 1000));
    assert.ok(daily.every((row) => row.kind === "income"));
    const pubExpense = await request("/cash", { ...expense, cash_box: "pub" });
    assert.equal(pubExpense.status, 201);
    assert.ok((await request(monthPath + "&box=pub")).body.some((row) => row.kind === "expense" && row.id === pubExpense.body.id));
    assert.ok(!(await request(monthPath)).body.some((row) => row.source === "manual" && row.id === pubExpense.body.id));
    assert.equal((await request("/cash/daily?box=otro")).status, 400);

    const admin = await request("/users", {
      name: "Administración", username: "admin-demo", password: "clave-segura-prueba", role: "admin",
    });
    assert.equal(admin.status, 201);
    const adminLogin = await request("/auth/login", { username: "admin-demo", password: "clave-segura-prueba" });
    const adminRequest = (path, body, method) => request(path, body, method, adminLogin.cookie);
    assert.ok((await adminRequest("/users")).body.every((user) => user.role !== "superadmin"));
    assert.equal((await adminRequest(`/users/${setup.body.id}`, { name: "Cambio" }, "PATCH")).status, 404);
    assert.equal((await adminRequest("/users", { role: "superadmin" })).status, 403);
    assert.ok((await adminRequest("/notes")).body.every((row) => row.id !== reply.body.id));
    assert.equal((await adminRequest(`/notes/${reply.body.id}`, { resolved: 1 }, "PATCH")).status, 404);
    assert.equal((await adminRequest("/notes", { body: "Prueba", category: "handover", reply_to: reply.body.id })).status, 404);
    const hiddenAuthor = (await adminRequest("/cash/monthly?month=2026-11")).body
      .find((row) => row.source === "folio" && row.id === qr.body.id);
    assert.equal(hiddenAuthor.author, "Atatau");
    assert.equal(hiddenAuthor.user_id, undefined);
    const protectedReservation = (await adminRequest("/reservations")).body.find((row) => row.id === first.body.id);
    assert.equal(protectedReservation.created_by, null);

    const roomPath = `/rooms/${dorm.body.id}`;
    const dormBed = rooms[1].units.at(-1).id;
    const stay = {
      ...draft, guest_name: "Prueba de capacidad", pax: 1, platform_id: 1,
      status: "confirmed", unit_ids: [dormBed], check_in: "2099-11-01", check_out: "2099-11-02",
    };
    assert.equal((await request("/reservations", stay)).status, 201);
    assert.equal((await adminRequest(roomPath, { capacity: 1, name: "Dormitorio actualizado" }, "PATCH")).status, 200);
    const smaller = (await request("/rooms")).body.find((row) => row.id === dorm.body.id);
    assert.equal(smaller.name, "Dormitorio actualizado");
    assert.deepEqual(smaller.units.filter((u) => u.active).map((u) => u.id), [dormBed]);
    assert.equal((await request("/reservations", { ...stay, unit_ids: [rooms[1].units[0].id] })).status, 400);
    assert.equal((await adminRequest(roomPath, { capacity: 6 }, "PATCH")).status, 200);
    const restored = (await request("/rooms")).body.find((row) => row.id === dorm.body.id);
    assert.deepEqual(restored.units.filter((u) => u.active).map((u) => u.id), rooms[1].units.map((u) => u.id));
    assert.equal((await request("/reservations", { ...stay, pax: 2, unit_ids: [rooms[0].units[0].id] })).status, 201);
    assert.equal((await adminRequest(`/rooms/${room.body.id}`, { capacity: 1 }, "PATCH")).status, 409);
    assert.equal(
      (await request(`/users/${receptionist.body.id}`, { active: 0 }, "PATCH"))
        .status,
      200,
    );
    assert.equal(
      (await request("/rooms", undefined, "GET", receptionLogin.cookie)).status,
      401,
      "desactivar usuario revoca su acceso",
    );
    assert.equal(
      (await request("/users/1", { active: 0 }, "PATCH")).status,
      400,
    );
    assert.ok(db.prepare("SELECT count(*) AS n FROM audit_log").get().n > 0);
    const foreignOrigin = await fetch(`${base}/notes`, {
      method: "POST",
      headers: {
        origin: "https://example.com",
        "Content-Type": "application/json",
        cookie,
      },
      body: "{}",
    });
    assert.equal(foreignOrigin.status, 403);
    const csrf = await fetch(`${base}/notes`, {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:9999",
        "Content-Type": "application/json",
        cookie,
      },
      body: "{}",
    });
    assert.equal(csrf.status, 403);
    assert.equal((await request("/auth/logout", {})).status, 200);
    assert.equal((await request("/rooms")).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
