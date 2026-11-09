import { createApp } from "./app.js";
import { openDatabase } from "./core/database.js";
import { createServer } from "node:http";

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
console.log(`Hostel Atatau · http://${host}:${port}`);
function stop() {
  server.close(() => {
    db.close();
    process.exit();
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
