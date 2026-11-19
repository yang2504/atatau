import { createApp } from "./app.js";
import { openDatabase } from "./core/database.js";
import { closeOpenTurns } from "./modules/users.js";
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const host = "127.0.0.1";
const port = 3001;
const server = createServer();
server.on("error", (error) => {
  console.error(`No se puede iniciar Hostel Atatau en http://${host}:${port} (${error.code}).`);
  if (error.code === "EADDRINUSE")
    console.error("Si Hostel Atatau ya está abierto, úsalo en esa dirección. Para reiniciar, detén la instancia anterior con Ctrl+C en su terminal.");
  process.exitCode = 1;
});

// Reserve the port before opening or migrating the database.
server.listen(port, host);
await new Promise((resolve) => {
  server.once("listening", resolve);
  server.once("error", resolve);
});
if (!server.listening) process.exit(1);
const db = openDatabase();
server.on("request", createApp(db));
const address = `http://${host}:${port}`;
console.log(`Hostel Atatau · ${address}`);
if (process.platform === "win32" && process.argv.includes("--open"))
  execFile("explorer.exe", [address]);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    closeOpenTurns(db);
    db.close();
    process.exit();
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// El ejecutable de Windows controla solo su propio proceso mediante una tubería privada.
if (process.argv.includes("--desktop")) {
  process.stdin.setEncoding("utf8");
  let command = "";
  process.stdin.on("data", (chunk) => {
    command += chunk;
    if (command.includes("\n")) {
      if (command.split("\n")[0].trim() === "shutdown") stop();
      command = "";
    }
  });
  process.stdin.on("end", stop);
  process.stdin.on("error", stop);
  process.stdin.resume();
}
