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
    assert.equal((await request("/scanner/document", {})).status, 401);
    assert.equal((await request("/auth/setup", [])).status, 400);
    const setup = await request("/auth/setup", {
      name: "Prueba",
      username: "owner",
      password: "clave-segura-prueba",
    });
    assert.equal(setup.status, 200);
    cookie = setup.cookie;
    const emptyTurn = (await request("/cash/turns/current")).body;
    assert.equal(emptyTurn.id, null);
    assert.deepEqual(emptyTurn.entries, []);
    assert.deepEqual((await request("/cash/turns")).body, []);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cash_turns").get().n, 0);
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
      day: "2026-12-01",
      service: "Lavandería",
      detail: "Una carga",
      total_cents: 2500,
    });
    assert.equal(service.status, 201);
    const listedFolio = (await request("/folios")).body.find((row) => row.id === folio.id);
    assert.equal(listedFolio.room_id, room.body.id);
    assert.deepEqual(listedFolio.service_months, ["2026-12"]);
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
    assert.equal(folios.length, 3);
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
    const weekday = (new Date(localDay()).getUTCDay() + 6) % 7;
    const shift = { user_id: receptionist.body.id, weekday, start_minute: 0, duration: 1440 };
    assert.equal((await request("/shifts", shift)).status, 201);
    assert.equal((await request("/shifts", { ...shift, start_minute: 60 })).status, 409);
    const receptionLogin = await request("/auth/login", {
      username: "recepcion",
      password: "clave-de-recepcion",
    }, "POST", "");
    assert.equal(receptionLogin.status, 200);
    assert.equal((await request("/shifts", undefined, "GET", receptionLogin.cookie)).status, 403);
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
    assert.equal((await request("/cash", { ...manual, cash_box: "pub" })).status, 400);
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
      && row.surcharge_cents === 250 && row.cash_cents === 5000 && row.physical_cents === 0));
    assert.ok(!(await request("/cash/monthly?month=2026-11&box=pub")).body.some((row) => row.source === "folio"));
    assert.ok(historic.some((row) => row.source === "folio" && row.id === remainder.body.id && row.voided === 1));

    const beverages = await request("/pub/categories", { name: "Bebidas" });
    assert.equal(beverages.status, 201);
    const categoryPath = `/pub/categories/${beverages.body.id}`;
    assert.equal((await request("/pub/categories", { name: "bebidas" })).status, 409);
    assert.equal((await request("/pub/categories", { name: "Snacks" }, "POST", receptionLogin.cookie)).status, 403);
    assert.equal((await request(categoryPath, { name: "Bebidas frías" }, "PATCH")).body.name, "Bebidas frías");
    assert.equal((await request("/pub/categories", undefined, "GET", receptionLogin.cookie)).body[0].name, "Bebidas frías");
    assert.equal((await request("/pub", { name: "Inválido", price_cents: 1500, category_id: 999 })).status, 404);
    const product = await request("/pub", { name: "Powerade", price_cents: 1500, category_id: beverages.body.id });
    assert.equal(product.status, 201);
    assert.equal((await request(`/pub/${product.body.id}`, { name: "Powerade", price_cents: 1500 }, "PATCH")).status, 200);
    assert.equal((await request("/pop")).body[0].category_id, beverages.body.id);
    const movements = `/pop/${product.body.id}/movements`;
    const arrival = { kind: "in", quantity: 2, detail: "Reposición" };
    assert.equal((await request(movements, arrival, "POST", receptionLogin.cookie)).status, 403);
    assert.equal((await request(movements, arrival)).body.stock, 2);
    const sale = { kind: "sale", quantity: 2, method: "Tarjeta", base_cents: 3000, cash_box: "petty" };
    assert.equal((await request(movements, { ...sale, base_cents: 100 }, "POST", receptionLogin.cookie)).status, 409);
    assert.equal((await request(movements, sale, "POST", receptionLogin.cookie)).body.collected_cents, 3150);
    assert.equal((await request(movements, sale, "POST", receptionLogin.cookie)).status, 409);
    assert.equal((await request("/pop")).body[0].stock, 0);
    assert.equal((await request(categoryPath, {}, "DELETE", receptionLogin.cookie)).status, 403);
    assert.equal((await request(categoryPath, {}, "DELETE")).status, 200);
    const uncategorized = (await request("/pub")).body[0];
    assert.equal(uncategorized.category_id, null);
    assert.equal(uncategorized.stock, 0);
    assert.ok((await request("/pub/movements")).body.some((row) => row.product_id === product.body.id && row.kind === "sale"));
    const daily = (await request("/cash/daily", undefined, "GET", receptionLogin.cookie)).body;
    const pubDaily = (await request("/cash/daily?box=pub", undefined, "GET", receptionLogin.cookie)).body;
    assert.ok(pubDaily.some((row) => row.source === "pop" && row.surcharge_cents === 150
      && row.cash_cents === 3000 && row.physical_cents === 0));
    assert.ok(daily.every((row) => row.cash_box === "petty" && row.source !== "pop"));
    assert.ok(daily.some((row) => row.source === "manual" && row.id === manualCard.body.id
      && row.surcharge_cents === 50 && row.cash_cents === 1000));
    assert.ok(daily.every((row) => row.kind === "income"));
    const pubExpense = await request("/cash", { ...expense, method: "Efectivo", cash_box: "pub" });
    assert.equal(pubExpense.status, 201);
    assert.ok((await request(monthPath + "&box=pub")).body.some((row) => row.kind === "expense"
      && row.id === pubExpense.body.id && row.physical_cents === 1000));
    assert.ok(!(await request(monthPath)).body.some((row) => row.source === "manual" && row.id === pubExpense.body.id));
    assert.equal((await request("/cash/daily?box=otro")).status, 400);
    const emptyLegacy = db.prepare(`INSERT INTO cash_turns(user_id,user_name,started_at,expires_at,window_key)
      VALUES(?,?,?,?,?) RETURNING id`).get(receptionist.body.id, "Recepción", "2020-01-01T12:00:00.000Z",
      "2020-01-01T13:00:00.000Z", "extra:2020-01-01T12:00:00.000Z");
    assert.ok(!(await request("/cash/turns", undefined, "GET", receptionLogin.cookie)).body.some((row) => row.id === emptyLegacy.id));
    assert.equal((await request(`/cash/turns/${emptyLegacy.id}`, undefined, "GET", receptionLogin.cookie)).body.id, emptyLegacy.id);
    const ownTurn = (await request("/cash/turns/current", undefined, "GET", receptionLogin.cookie)).body;
    assert.deepEqual(ownTurn.entries.map((row) => [row.source, row.id]), [["manual", manualCard.body.id]]);
    assert.ok(ownTurn.entries[0].recorded_at);
    assert.equal(ownTurn.entries[0].physical_cents, 0);
    assert.equal((await request("/cash/turns/current?box=pub", undefined, "GET", receptionLogin.cookie)).body.entries.length, 1);
    const ownerTurn = (await request("/cash/turns/current")).body;
    assert.equal((await request(`/cash/turns/${ownerTurn.id}`, undefined, "GET", receptionLogin.cookie)).status, 404);
    assert.equal((await request("/audit", undefined, "GET", receptionLogin.cookie)).status, 403);
    assert.equal((await request("/lodging-exchange-rate", { scaled_rate: 70000 }, "PUT", receptionLogin.cookie)).status, 403);
    assert.equal((await request("/lodging-exchange-rate", { scaled_rate: 0 }, "PUT")).status, 400);
    assert.equal((await request("/lodging-exchange-rate", { scaled_rate: 70000 }, "PUT")).status, 200);
    assert.equal((await request("/lodging-exchange-rate", undefined, "GET", receptionLogin.cookie)).body.scaled_rate, 70000);

    const admin = await request("/users", {
      name: "Administración", username: "admin-demo", password: "clave-segura-prueba", role: "admin",
    });
    assert.equal(admin.status, 201);
    const adminLogin = await request("/auth/login", { username: "admin-demo", password: "clave-segura-prueba" }, "POST", "");
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
    assert.equal(protectedReservation.created_by_name, "Atatau");
    assert.equal(protectedReservation.checked_in_by_name, "Recepción");
    assert.equal(protectedReservation.checked_out_by_name, null);

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

    const pendingStay = {
      ...stay, guest_name: "Cobro en recepción", status: "pending", pax: 2,
      unit_ids: rooms[1].units.slice(0, 2).map((unit) => unit.id),
      folio_mode: "individual", nightly_cents: 10101,
      check_in: "2099-12-01", check_out: "2099-12-03",
    };
    const booking = await request("/reservations", pendingStay);
    assert.equal(booking.status, 201);
    const bookingPath = `/reservations/${booking.body.id}`;
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM folios WHERE reservation_id=?").get(booking.body.id).n, 0);
    const pendingWithAdvance = {
      ...pendingStay, advance_payment: { amount_cents: 100, method: "QR", expected_balance_cents: 20202 },
    };
    assert.equal((await request(bookingPath, pendingWithAdvance, "PUT")).status, 200);
    assert.equal((await request(bookingPath, pendingWithAdvance, "PUT")).status, 409);
    const stayFolios = (await request("/folios")).body
      .filter((row) => row.reservation_id === booking.body.id).sort((a, b) => a.id - b.id);
    assert.equal(stayFolios.length, 2);
    assert.ok(stayFolios.every((row) => row.room_type === "dorm" && row.paid_months.includes(today.slice(0, 7))));
    const stayPath = `/folios/${stayFolios[0].id}`;
    const checkIn = { ...pendingStay, status: "in_house", check_in_payment: { amount_cents: 20102, method: "Tarjeta" } };
    const stale = { ...checkIn, check_in_payment: { ...checkIn.check_in_payment, amount_cents: 20202 } };
    assert.equal((await request(bookingPath, stale, "PUT")).status, 409);
    assert.equal((await request("/reservations")).body.find((row) => row.id === booking.body.id).status, "pending");
    assert.equal((await adminRequest(bookingPath, checkIn, "PUT")).status, 200);
    assert.equal((await adminRequest(bookingPath, checkIn, "PUT")).status, 409);
    const stayDetail = (await request(stayPath)).body;
    assert.equal(stayDetail.stay_payments.length, 2);
    const receipt = stayDetail.stay_payments[0];
    assert.equal(receipt.amount_cents, 20102);
    assert.equal(receipt.surcharge_cents, 1005);
    assert.equal(receipt.author, "Administración");
    assert.ok(stayDetail.entries.every((row) => row.cashiers.includes("Administración")));
    assert.ok(stayDetail.entries.every((row) => row.balance_cents === 0));
    const otherDetail = (await request(`/folios/${stayFolios[1].id}`)).body;
    assert.equal(otherDetail.stay_payments[0].id, receipt.id);
    assert.ok(otherDetail.entries.every((row) => row.balance_cents === 0 && row.payments.length === 0));
    assert.deepEqual((await request("/cash/daily")).body.filter((row) => row.source === "stay").map((row) => row.cash_cents), [20102, 100]);
    assert.ok(!(await request("/cash/daily?box=pub")).body.some((row) => row.source === "stay"));
    assert.deepEqual((await adminRequest("/cash/turns/current")).body.entries
      .filter((row) => row.source === "stay").map((row) => row.cash_cents), [20102]);
    assert.equal((await adminRequest("/cash/turns/current")).body.entries
      .find((row) => row.source === "stay").physical_cents, 0);
    const checkInEvents = (await adminRequest("/audit")).body.filter((event) =>
      event.entity === "reservation" && event.entity_id === booking.body.id && event.action === "check_in");
    assert.equal(checkInEvents.length, 1);
    assert.equal(checkInEvents[0].author, "Administración");
    assert.equal(checkInEvents[0].before.status, "pending");
    assert.equal(checkInEvents[0].after.status, "in_house");

    const editPath = stayPath + `/stay-payments/${receipt.id}`;
    const badCorrection = await request(editPath, { day: today, method: "Efectivo", amount_cents: 30000 }, "PATCH");
    assert.equal(badCorrection.status, 409);
    assert.equal((await request(stayPath)).body.stay_payments[0].voided, 0);
    const correction = await request(editPath, { day: today, method: "Efectivo", amount_cents: 20000 }, "PATCH");
    assert.equal(correction.status, 200);
    const afterCorrection = (await request(stayPath)).body.stay_payments;
    assert.equal(afterCorrection.find((row) => row.id === receipt.id).voided, 1);
    assert.equal(afterCorrection.find((row) => row.id === correction.body.id).amount_cents, 20000);
    assert.equal((await request(stayPath + `/stay-payments/${correction.body.id}/void`, {})).status, 200);
    const deposit = { day: today, lodging_day: pendingStay.check_in, amount_cents: 100, method: "QR" };
    const single = await request(stayPath + "/payments", deposit);
    assert.equal(single.status, 201);
    const singlePath = stayPath + `/payments/${single.body.id}`;
    assert.equal((await adminRequest(singlePath, deposit, "PATCH")).status, 403);
    const changedAdvance = await request(singlePath, { ...deposit, amount_cents: 200 }, "PATCH");
    assert.equal(changedAdvance.status, 200);
    assert.equal((await request(stayPath)).body.entries[0].paid_cents, 300);
    const regularRefund = await request(stayPath + `/payments/${changedAdvance.body.id}/refunds`,
      { amount_cents: 50, reason: "Devolución parcial QR" }, "POST", receptionLogin.cookie);
    assert.equal(regularRefund.status, 201);
    const regularRefundSheet = (await request(stayPath, undefined, "GET", receptionLogin.cookie)).body;
    assert.equal(regularRefundSheet.entries[0].paid_cents, 250);
    assert.equal(regularRefundSheet.refunds[0].author, "Recepción turno tarde");
    assert.equal(regularRefundSheet.refunds[0].method, "QR");
    assert.equal((await request(stayPath + `/payments/${changedAdvance.body.id}`, deposit, "PATCH")).status, 409);

    const groupHolder = {
      ...draft, platform_id: 1, status: "pending", guest_name: "Titular reserva",
      folio_holder: "Encargada del grupo", check_in: "2099-10-01", check_out: "2099-10-02",
    };
    const holderBooking = await request("/reservations", groupHolder);
    assert.equal(holderBooking.status, 201);
    const holderPath = `/reservations/${holderBooking.body.id}`;
    assert.ok(!(await request("/folios")).body.some((row) => row.reservation_id === holderBooking.body.id));
    assert.equal((await request(holderPath, { ...groupHolder, status: "confirmed" }, "PUT")).status, 200);
    const holderSheets = (await request("/folios")).body.filter((row) => row.reservation_id === holderBooking.body.id);
    assert.equal(holderSheets.length, 1);
    assert.equal(holderSheets[0].room_type, "private");
    assert.equal(holderSheets[0].title, "Encargada del grupo");

    const promotionalSheet = `/folios/${holderSheets[0].id}`;
    assert.equal((await request(promotionalSheet + "/payments", {
      day: today, lodging_day: groupHolder.check_in, amount_cents: groupHolder.nightly_cents, method: "QR",
    })).status, 201);
    const extended = {
      expected_check_in: groupHolder.check_in, expected_check_out: groupHolder.check_out,
      check_in: "2099-09-30", check_out: "2099-10-03", extension_nightly_cents: 21000,
    };
    assert.equal((await request(holderPath + "/extend", extended)).status, 200);
    assert.equal((await request(holderPath + "/extend", extended)).status, 409);
    const nights = (await request(promotionalSheet)).body.entries;
    assert.deepEqual(nights.map((row) => row.total_cents), [21000, groupHolder.nightly_cents, 21000]);
    assert.deepEqual(nights.map((row) => row.balance_cents), [21000, 0, 21000]);
    const continued = (await request("/reservations")).body.find((row) => row.id === holderBooking.body.id);
    assert.deepEqual(continued.paid_nights, [groupHolder.check_in]);
    assert.deepEqual(continued.night_rates, { "2099-09-30": 21000, "2099-10-02": 21000 });
    assert.equal((await request("/reservations", {
      ...groupHolder, status: "confirmed", check_in: "2099-10-03", check_out: "2099-10-04",
    })).status, 201);
    assert.equal((await request(holderPath + "/extend", {
      ...extended, expected_check_in: extended.check_in, expected_check_out: extended.check_out,
      check_out: "2099-10-04",
    })).status, 409);
    assert.equal((await request(promotionalSheet)).body.entries.length, 3);
    assert.equal((await request(holderPath, {
      ...continued, status: "in_house", check_in_payment: { amount_cents: 42000, method: "Efectivo" },
    }, "PUT")).status, 200);
    assert.ok((await request(promotionalSheet)).body.entries.every((row) => row.balance_cents === 0));
    const departure = { ...continued, status: "checked_out" };
    assert.equal((await adminRequest(holderPath, departure, "PUT")).status, 200);
    assert.equal((await request(holderPath, { ...departure, comments: "Edición posterior" }, "PUT")).status, 200);
    const attributed = (await request("/reservations")).body.find((row) => row.id === holderBooking.body.id);
    assert.equal(attributed.created_by_name, setup.body.name);
    assert.equal(attributed.checked_in_by_name, setup.body.name);
    assert.equal(attributed.checked_out_by_name, "Administración");
    const masked = (await adminRequest("/reservations")).body.find((row) => row.id === holderBooking.body.id);
    assert.deepEqual([masked.created_by_name, masked.checked_in_by_name, masked.checked_out_by_name],
      ["Atatau", "Atatau", "Administración"]);
    const grouped = (await request(promotionalSheet)).body.stay_payments[0];
    const refundPath = promotionalSheet + `/stay-payments/${grouped.id}/refunds`;
    assert.equal((await request(refundPath, { amount_cents: 1200, reason: "Ajuste de hospedaje" },
      "POST", "")).status, 401);
    const partial = await request(refundPath, { amount_cents: 1200, reason: "Ajuste de hospedaje" }, "POST", receptionLogin.cookie);
    assert.equal(partial.status, 201);
    assert.equal((await adminRequest(refundPath, { amount_cents: 42000, reason: "Excede el cobro" })).status, 409);
    const afterRefund = (await request(promotionalSheet, undefined, "GET", receptionLogin.cookie)).body;
    assert.equal(afterRefund.entries.reduce((sum, row) => sum + row.balance_cents, 0), 1200);
    assert.equal(afterRefund.stay_payments[0].retained_cents, 40800);
    assert.equal(afterRefund.refunds[0].author, "Recepción turno tarde");
    assert.equal(afterRefund.refunds[0].reason, "Ajuste de hospedaje");
    const turnWithRefunds = (await request("/cash/turns/current", undefined, "GET", receptionLogin.cookie)).body;
    const refundRow = turnWithRefunds.entries
      .find((row) => row.source === "refund" && row.id === partial.body.id);
    assert.equal(refundRow.physical_cents, 1200);
    assert.equal(refundRow.kind, "expense");
    assert.ok(!(await request("/cash/turns/current?box=pub", undefined, "GET", receptionLogin.cookie)).body.entries.some((row) => row.source === "refund"));
    const moved = {
      ...stay, guest_name: "Traslado auditado", check_in: "2098-01-01", check_out: "2098-01-02",
    };
    const move = await request("/reservations", moved, "POST", receptionLogin.cookie);
    assert.equal(move.status, 201);
    const movePath = `/reservations/${move.body.id}`;
    const relocated = {
      ...moved, check_in: "2098-01-02", check_out: "2098-01-03", unit_ids: [rooms[0].units[0].id],
    };
    assert.equal((await adminRequest(movePath, relocated, "PUT")).status, 200);
    assert.equal((await adminRequest(movePath, { ...relocated, status: "cancelled" }, "PUT")).status, 200);
    const history = (await adminRequest("/audit")).body.filter((event) =>
      event.entity === "reservation" && event.entity_id === move.body.id);
    assert.deepEqual(history.map((event) => event.action), ["cancel", "update", "create"]);
    assert.equal(history[0].after.status, "cancelled");
    assert.equal(history[1].before.check_in, moved.check_in);
    assert.equal(history[1].after.check_in, relocated.check_in);
    assert.equal(history[1].before.units[0].room_id, dorm.body.id);
    assert.equal(history[1].after.units[0].room_id, room.body.id);
    assert.notEqual(history[1].author, history[2].author);
    assert.ok(history.every((event) => event.created_at.endsWith("Z")));

    assert.equal((await request("/auth/logout", {}, "POST", receptionLogin.cookie)).status, 200);
    const secondReception = await request("/auth/login", {
      username: "recepcion", password: "clave-de-recepcion",
    }, "POST", "");
    assert.equal(secondReception.status, 200);
    const newTurn = (await request("/cash/turns/current", undefined, "GET", secondReception.cookie)).body;
    assert.equal(newTurn.id, ownTurn.id);
    assert.equal(newTurn.expires_at, ownTurn.expires_at);
    assert.deepEqual(newTurn.entries, turnWithRefunds.entries);
    const previous = (await request(`/cash/turns/${ownTurn.id}`, undefined, "GET", secondReception.cookie)).body;
    assert.equal(previous.ended_at, null);
    assert.deepEqual(previous.entries, turnWithRefunds.entries);
    assert.equal(
      (await request(`/users/${receptionist.body.id}`, { active: 0 }, "PATCH"))
        .status,
      200,
    );
    assert.equal(
      (await request("/rooms", undefined, "GET", secondReception.cookie)).status,
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
    const secondDorm = await request("/rooms", { name: "Dormitorio norte", type: "dorm", capacity: 2 });
    assert.equal(secondDorm.status, 201);
    const dormUnit = (await request("/rooms")).body.find((item) => item.id === secondDorm.body.id).units[0].id;
    const bookingGroup = {
      ...draft, guest_name: "Encargada del grupo", guest_names: ["Ana", "Bruno", "Clara", "Diego"],
      check_in: "2027-10-03", check_out: "2027-10-05", pax: 4, breakfast: 1,
      nightly_cents: 30000, platform_id: 1, status: "pending",
      room_assignments: [
        { room_id: room.body.id, pax: 2, unit_ids: draft.unit_ids },
        { room_id: dorm.body.id, pax: 1, unit_ids: [rooms[1].units[0].id] },
        { room_id: secondDorm.body.id, pax: 1, unit_ids: [dormUnit] },
      ],
      advance_payment: { method: "QR", amount_cents: 35000, expected_balance_cents: 60000 },
    };
    const reservationCount = () => db.prepare("SELECT COUNT(*) AS n FROM reservations").get().n;
    const initialCount = reservationCount();
    const wrongCapacity = bookingGroup.room_assignments.map((item, i) => ({ ...item, pax: i === 0 ? 3 : item.pax }));
    assert.equal((await request("/reservations", { ...bookingGroup, pax: 5, room_assignments: wrongCapacity })).status, 400);
    assert.equal((await request("/reservations", { ...bookingGroup, folio_mode: "individual" })).status, 400);
    const wrongBalance = await request("/reservations", {
      ...bookingGroup, advance_payment: { ...bookingGroup.advance_payment, expected_balance_cents: 50000 },
    });
    assert.equal(wrongBalance.status, 409, wrongBalance.body.error);
    assert.equal(reservationCount(), initialCount);

    const groupCreated = await request("/reservations", bookingGroup);
    assert.equal(groupCreated.status, 201);
    const groupId = groupCreated.body.id;
    const savedGroup = (await request("/reservations")).body.find((item) => item.id === groupId);
    assert.deepEqual(savedGroup.room_assignments, bookingGroup.room_assignments);
    assert.equal(savedGroup.lodging_paid_cents, 35000);
    assert.equal((await request("/reservations", {
      ...draft, check_in: bookingGroup.check_in, check_out: bookingGroup.check_out,
      pax: 1, platform_id: 1, unit_ids: [dormUnit],
    })).status, 409);
    const breakfasts = (await request("/reservations/breakfast?day=2027-10-04")).body
      .filter((item) => item.reservation_id === groupId);
    assert.equal(breakfasts.length, 4);
    assert.equal(breakfasts.find((item) => item.name === "Diego").room_name, "Dormitorio norte");
    const groupSheets = (await request("/folios")).body.filter((item) => item.reservation_id === groupId);
    assert.equal(groupSheets.length, 1);
    assert.equal(groupSheets[0].title, "Encargada del grupo");
    const groupSheet = `/folios/${groupSheets[0].id}`;
    const details = (await request(groupSheet)).body;
    const advance = details.stay_payments[0];
    assert.equal(details.stay_payments.length, 1);
    assert.deepEqual(details.entries.map((entry) => entry.balance_cents), [0, 25000]);
    const cashGroup = (await request("/cash/daily")).body.filter((item) => item.source === "stay" && item.id === advance.id);
    assert.equal(cashGroup.length, 1);
    assert.equal(cashGroup[0].base_cents, 35000);
    assert.equal(cashGroup[0].physical_cents, 0);
    const nextAdvance = { day: localDay(), method: "Efectivo", amount_cents: 5000, expected_balance_cents: 25000 };
    assert.equal((await request(groupSheet + "/stay-payments", nextAdvance)).status, 201);
    assert.equal((await request(groupSheet + "/stay-payments", nextAdvance)).status, 409);
    assert.equal((await request(groupSheet + `/stay-payments/${advance.id}/refunds`, {
      amount_cents: 1000, reason: "Devolución parcial de prueba",
    })).status, 201);
    const groupRoute = `/reservations/${groupId}`;
    const groupEdit = { ...bookingGroup, advance_payment: undefined };
    assert.equal((await request(groupRoute + "/extend", {
      expected_check_in: bookingGroup.check_in, expected_check_out: bookingGroup.check_out,
      check_in: bookingGroup.check_in, check_out: "2027-10-06", extension_nightly_cents: 25000,
    })).status, 200);
    assert.equal((await request(groupRoute, { ...groupEdit, check_out: "2027-10-06", status: "in_house" }, "PUT")).status, 200);
    assert.equal((await request(groupRoute, { ...groupEdit, check_out: "2027-10-06", status: "cancelled" }, "PUT")).status, 200);
    assert.equal((await request(groupSheet + "/stay-payments", nextAdvance)).status, 409);
    const historicalSheet = (await request(groupSheet)).body;
    assert.equal(historicalSheet.stay_payments.length, 2);
    assert.equal(historicalSheet.refunds.length, 1);
    assert.equal((await request("/reservations", {
      ...draft, check_in: bookingGroup.check_in, check_out: bookingGroup.check_out, pax: 1, platform_id: 1, unit_ids: [dormUnit],
    })).status, 201);
    const lateRoom = await request("/rooms", { name: "Dormitorio de siete", type: "dorm", capacity: 7 });
    const beds = (await request("/rooms")).body.find((room) => room.id === lateRoom.body.id).units.map((unit) => unit.id);
    const lateStay = { ...draft, platform_id: 1, pax: 6, unit_ids: beds.slice(0, 6), breakfast: 1,
      check_in: "2090-04-01", check_out: "2090-04-05", nightly_cents: 60000 };
    const booked = await request("/reservations", lateStay);
    assert.equal(booked.status, 201);
    const latePath = `/reservations/${booked.body.id}`;
    const shared = (await request("/folios")).body.find((folio) => folio.reservation_id === booked.body.id);
    const sharedPath = `/folios/${shared.id}`;
    const historicalPayment = await request(sharedPath + "/payments", {
      lodging_day: "2090-04-01", amount_cents: 60000, day: localDay(), method: "QR",
    });
    assert.equal(historicalPayment.status, 201);
    const earlyStay = { ...lateStay, pax: 1, unit_ids: beds.slice(-1), check_out: "2090-04-03" };
    assert.equal((await request("/reservations", earlyStay)).status, 201);
    const addition = { name: "Llegó después", unit_id: beds[6], joined_on: "2090-04-03", nightly_cents: 10000,
      expected_added: 0, expected_check_out: lateStay.check_out };
    assert.equal((await request(latePath + "/guests", { ...addition, joined_on: "2090-04-02" })).status, 409);
    assert.equal((await request(latePath + "/guests", { ...addition, joined_on: lateStay.check_out })).status, 400);
    const added = await request(latePath + "/guests", addition);
    assert.equal(added.status, 201, added.body.error);
    assert.equal((await request(latePath + "/guests", addition)).status, 409);
    assert.equal((await request(latePath + "/guests", { ...addition, expected_added: 1 })).status, 409);
    assert.equal((await request("/reservations", { ...earlyStay, check_in: "2090-04-03", check_out: "2090-04-04" })).status, 409);
    const lateDetails = (await request(sharedPath)).body;
    assert.deepEqual(lateDetails.entries.map((entry) => entry.total_cents), [60000, 60000, 70000, 70000]);
    assert.equal(lateDetails.entries[0].paid_cents, 60000);
    for (const [day, count] of [["2090-04-03", 6], ["2090-04-04", 7]]) {
      const meals = (await request(`/reservations/breakfast?day=${day}`)).body;
      assert.equal(meals.filter((row) => row.reservation_id === booked.body.id).length, count);
    }
    assert.equal((await request(`/rooms/${lateRoom.body.id}`, { capacity: 6 }, "PATCH")).status, 409);
    const privateStay = { ...lateStay, pax: 1, folio_mode: "individual", unit_ids: draft.unit_ids };
    const privateBooking = await request("/reservations", privateStay);
    assert.equal(privateBooking.status, 201);
    const privatePath = `/reservations/${privateBooking.body.id}`;
    assert.equal((await request(privatePath + "/guests", { ...addition, unit_id: draft.unit_ids[0] })).status, 201);
    assert.equal((await request(privatePath + "/guests", { ...addition, unit_id: draft.unit_ids[0], expected_added: 1 })).status, 409);
    const privateFolios = (await request("/folios")).body.filter((folio) => folio.reservation_id === privateBooking.body.id);
    assert.equal(privateFolios.length, 2);
    for (const folio of privateFolios) {
      const sheet = (await request(`/folios/${folio.id}`)).body;
      assert.deepEqual(sheet.entries.map((entry) => entry.total_cents), folio.joined_on ? [10000, 10000] : [60000, 60000, 60000, 60000]);
    }
    const extraGroup = await request("/reservations", {
      ...bookingGroup, check_in: "2090-05-01", check_out: "2090-05-05",
      status: "pending", advance_payment: undefined,
    });
    assert.equal(extraGroup.status, 201, extraGroup.body.error);
    const extraGroupId = extraGroup.body.id;
    const addedToGroup = await request(`/reservations/${extraGroupId}/guests`, {
      ...addition, unit_id: rooms[1].units[1].id, joined_on: "2090-05-03", expected_check_out: "2090-05-05", nightly_cents: 0,
    });
    assert.equal(addedToGroup.status, 201, addedToGroup.body.error);
    assert.equal((await request("/folios")).body.filter((folio) => folio.reservation_id === extraGroupId).length, 1);
    const groupMeals = (await request("/reservations/breakfast?day=2090-05-04")).body.filter((row) => row.reservation_id === extraGroupId);
    assert.equal(groupMeals.length, 5);
    assert.equal(groupMeals.find((row) => row.id === addedToGroup.body.id).room_name, "Dormitorio actualizado");
    const transferStay = { ...privateStay, guest_name: "Traslado de prueba", status: "in_house",
      folio_mode: "shared", check_in: "2090-07-01", check_out: "2090-07-04", nightly_cents: 10000 };
    const transferred = await request("/reservations", transferStay);
    assert.equal(transferred.status, 201, transferred.body.error);
    const transferPath = `/reservations/${transferred.body.id}`;
    const transferFolio = (await request("/folios")).body.find((folio) => folio.reservation_id === transferred.body.id);
    const transferSheet = `/folios/${transferFolio.id}`;
    assert.equal((await request(transferSheet + "/payments", {
      lodging_day: "2090-07-01", amount_cents: 10000, day: localDay(), method: "QR",
    })).status, 201);
    const destination = beds[0];
    const transfer = { day: "2090-07-03", check_out: "2090-07-05", unit_ids: [destination], nightly_cents: 15000,
      expected_check_out: transferStay.check_out, expected_last_move: null };
    const conflict = await request("/reservations", { ...transferStay, unit_ids: [destination], check_in: "2090-07-04", check_out: "2090-07-05" });
    assert.equal(conflict.status, 201);
    assert.equal((await request(transferPath + "/move", transfer)).status, 409);
    assert.equal((await request(`/reservations/${conflict.body.id}`, {
      ...transferStay, unit_ids: [destination], check_in: "2090-07-04", check_out: "2090-07-05", status: "cancelled",
    }, "PUT")).status, 200);
    const changed = await request(transferPath + "/move", transfer);
    assert.equal(changed.status, 200, changed.body.error);
    const recorded = (await request("/reservations")).body.find((row) => row.id === transferred.body.id);
    assert.deepEqual(recorded.occupancy, [
      { unit_id: transferStay.unit_ids[0], starts_on: "2090-07-01", ends_on: "2090-07-03" },
      { unit_id: destination, starts_on: "2090-07-03", ends_on: "2090-07-05" },
    ]);
    const reused = await request("/reservations", { ...transferStay, check_in: "2090-07-03", check_out: "2090-07-05" });
    assert.equal(reused.status, 201);
    assert.equal((await request("/reservations", { ...transferStay, unit_ids: [destination], check_in: "2090-07-04" , check_out: "2090-07-05" })).status, 409);
    const transferMeals = (await request("/reservations/breakfast?day=2090-07-04")).body
      .filter((row) => row.reservation_id === transferred.body.id);
    assert.equal(transferMeals[0].room_name, "Dormitorio de siete");
    const afterTransfer = (await request(transferSheet)).body;
    assert.equal(afterTransfer.id, transferFolio.id);
    assert.deepEqual(afterTransfer.entries.map((row) => row.total_cents), [10000, 10000, 15000, 15000]);
    assert.equal(afterTransfer.entries[0].paid_cents, 10000);
    const repricing = { start: "2090-07-01", end: "2090-07-02", nightly_cents: 9999,
      expected_rates: recorded.night_rates, expected_base: recorded.nightly_cents };
    assert.equal((await request(transferSheet + "/lodging-rate", repricing, "PATCH")).status, 409);
    assert.equal((await request(transferSheet + "/lodging-rate", { ...repricing, nightly_cents: 11000 }, "PATCH")).status, 200);
    const adjusted = (await request(transferSheet)).body.entries[0];
    assert.equal(adjusted.paid_cents, 10000);
    assert.equal(adjusted.balance_cents, 1000);
    const returnMove = await request(transferPath + "/move", {
      day: "2090-07-05", check_out: "2090-07-06", unit_ids: transferStay.unit_ids, nightly_cents: 12000,
      expected_check_out: "2090-07-05", expected_last_move: transfer.day,
    });
    assert.equal(returnMove.status, 200, returnMove.body.error);
    assert.deepEqual((await request(transferSheet)).body.entries.map((row) => row.total_cents), [11000, 10000, 15000, 15000, 12000]);
    const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
    const checkoutRoom = await request("/rooms", { name: "Salida de hoy QA", type: "private", capacity: 1 });
    const checkoutUnit = (await request("/rooms")).body.find((room) => room.id === checkoutRoom.body.id).units[0].id;
    const checkedOut = await request("/reservations", { ...transferStay, status: "checked_out",
      unit_ids: [checkoutUnit], check_in: yesterday, check_out: today });
    assert.equal(checkedOut.status, 201, checkedOut.body.error);
    const continuedToday = await request(`/reservations/${checkedOut.body.id}/move`, {
      day: today, check_out: tomorrow, unit_ids: [destination], nightly_cents: 12000,
      expected_check_out: today, expected_last_move: null,
    });
    assert.equal(continuedToday.status, 200, continuedToday.body.error);
    assert.equal((await request("/reservations")).body.find((row) => row.id === checkedOut.body.id).status, "in_house");
    const photo = Buffer.from([255, 216, 255, 217]);
    const snack = await request("/pub", { name: "Merienda QA", price_cents: 1250, low_stock: 2, photo: photo.toString("base64") });
    assert.equal(snack.status, 201, snack.body.error);
    const snackPath = `/pub/${snack.body.id}`;
    const loadedPhoto = await fetch(base + snackPath + "/photo", { headers: { cookie } });
    assert.equal(loadedPhoto.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from(await loadedPhoto.arrayBuffer()), photo);
    const listedSnack = (await request("/pub")).body.find((item) => item.id === snack.body.id);
    assert.equal(listedSnack.low_stock, 2);
    assert.ok(listedSnack.photo_revision);
    assert.equal(listedSnack.jpeg, undefined);
    assert.equal((await request(snackPath, { name: listedSnack.name, price_cents: 1250, photo: "aGVsbG8=" }, "PATCH")).status, 400);
    assert.equal((await request(snackPath + "/movements", { kind: "in", quantity: 3, detail: "Compra" })).status, 201);
    const guestSheet = (await request("/folios")).body.find((folio) => folio.reservation_id === checkedOut.body.id);
    const debt = { kind: "sale", quantity: 1, base_cents: 1250, folio_id: guestSheet.id };
    assert.equal((await request(snackPath + "/movements", { ...debt, folio_id: transferFolio.id })).status, 409);
    assert.equal((await request("/pub")).body.find((item) => item.id === snack.body.id).stock, 3);
    const credit = await request(snackPath + "/movements", debt);
    assert.equal(credit.status, 201, credit.body.error);
    assert.equal(credit.body.stock, 2);
    assert.equal(credit.body.cash_cents, 0);
    assert.ok(!(await request("/cash/daily?box=pub")).body.some((row) => row.source === "pop" && row.id === credit.body.id));
    const charge = (await request(`/folios/${guestSheet.id}`)).body.entries.find((entry) => entry.service === "Consumo Pub");
    assert.equal(charge.total_cents, 1250);
    const paymentPath = `/folios/${guestSheet.id}/payments`;
    const creditPayment = await request(paymentPath, { service_id: charge.service_id, day: today, amount_cents: 1000, method: "QR" });
    assert.equal(creditPayment.status, 201, creditPayment.body.error);
    assert.ok(!(await request("/cash/daily")).body.some((row) => row.source === "folio" && row.id === creditPayment.body.id));
    const pubIncome = (await request("/cash/daily?box=pub")).body.find((row) => row.source === "folio" && row.id === creditPayment.body.id);
    assert.equal(pubIncome.base_cents, 1000);
    assert.equal(pubIncome.physical_cents, 0);
    const pubRefund = await request(`${paymentPath}/${creditPayment.body.id}/refunds`, { amount_cents: 250, reason: "Ajuste" });
    assert.equal(pubRefund.status, 201, pubRefund.body.error);
    assert.equal((await request("/cash/daily?box=pub")).body.find((row) => row.source === "refund" && row.id === pubRefund.body.id).base_cents, 250);
    assert.ok(!(await request("/cash/daily")).body.some((row) => row.source === "refund" && row.id === pubRefund.body.id));
    assert.equal((await request(snackPath, { name: listedSnack.name, price_cents: 1250, photo: null }, "PATCH")).status, 200);
    assert.equal((await request(snackPath + "/photo")).status, 404);
    assert.equal((await request("/auth/logout", {})).status, 200);
    assert.equal((await request("/rooms")).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
