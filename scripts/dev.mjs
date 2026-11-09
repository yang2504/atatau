import { spawn } from "node:child_process";
import { createServer } from "node:net";

const npm = process.env.npm_execpath;
if (!npm) throw new Error("Inicia el desarrollo con npm run dev.");

const host = "127.0.0.1";
const ports = [3001, 5173];
const checks = await Promise.allSettled(
  ports.map((port) => new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, host, () => probe.close(resolve));
  })),
);
for (const [index, check] of checks.entries()) {
  if (check.status === "fulfilled") continue;
  console.error(`No se puede iniciar en http://${host}:${ports[index]} (${check.reason.code}).`);
  process.exitCode = 1;
}
if (process.exitCode) {
  if (checks.some((check) => check.status === "rejected" && check.reason.code === "EADDRINUSE"))
    console.error("Si Hostel Atatau ya está abierto, úsalo en esa dirección. Para reiniciar, detén la instancia anterior con Ctrl+C en su terminal.");
  process.exit(process.exitCode);
}

const children = ["backend", "frontend"].map((workspace) =>
  spawn(process.execPath, [npm, "run", "dev", "--workspace", workspace], {
    stdio: "inherit",
  }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform === "win32")
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else child.kill("SIGTERM");
  }
  process.exitCode = code;
}
children.forEach((child) => {
  child.on("error", () => stop(1));
  child.on("exit", (code) => stop(code ?? 0));
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
