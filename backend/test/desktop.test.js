import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { openDatabase } from "../src/core/database.js";
import { localDay } from "../src/core/charges.js";

test("el inicio de escritorio cierra SQLite sin perder movimientos ni reiniciar el turno", { timeout: 20000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "atatau-desktop-test-"));
  const path = join(directory, "qa.sqlite");
  const child = spawn(process.execPath, [fileURLToPath(new URL("../src/server.js", import.meta.url)), "--desktop"],
    { env: { ...process.env, ATATAU_DB: path }, stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let error = "";
  child.stderr.on("data", (chunk) => { error += chunk; });
  try {
    const started = await Promise.race([
      once(child.stdout, "data").then(() => true), exited.then(() => false),
    ]);
    if (!started && error.includes("EADDRINUSE")) return t.skip("El puerto 3001 ya está en uso; no se toca la instancia abierta.");
    assert.ok(started, error);
    const health = await fetch("http://127.0.0.1:3001/api/health").then((r) => r.json());
    assert.deepEqual(health, { ok: true, app: "hostel-atatau" });
    const setup = await fetch("http://127.0.0.1:3001/api/auth/setup", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "QA escritorio", username: "qa", password: "clave-ficticia-qa" }) });
    assert.equal(setup.status, 200);
    const payment = await fetch("http://127.0.0.1:3001/api/cash", { method: "POST",
      headers: { "Content-Type": "application/json", cookie: setup.headers.get("set-cookie").split(";")[0] },
      body: JSON.stringify({ day: localDay(), kind: "expense", detail: "Prueba de cierre", base_cents: 100, method: "Efectivo" }) });
    assert.equal(payment.status, 201);
    child.stdin.write("shutdown\n");
    const [code] = await exited;
    assert.equal(code, 0, error);
    const db = openDatabase(path);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cash_entries").get().n, 1);
      const turn = db.prepare("SELECT closed_at,window_key FROM cash_turns").get();
      assert.equal(turn.closed_at, null);
      assert.ok(turn.window_key);
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    } finally { db.close(); }
  } finally {
    if (child.exitCode === null) { child.stdin.end(); child.kill(); await exited; }
    await rm(directory, { recursive: true, force: true });
  }
});
