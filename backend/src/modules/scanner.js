import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { fail } from "../core/validation.js";

const run = promisify(execFile);
const script = fileURLToPath(new URL("./scan-document.ps1", import.meta.url));
let scanning = false;

export async function scanDocument(req, res) {
  if (process.platform !== "win32") fail("El escaneo directo requiere Windows.", 409);
  if (scanning) fail("Ya hay un escaneo en curso. Espera a que termine.", 409);
  scanning = true;
  let folder;
  try {
    folder = await mkdtemp(join(tmpdir(), "atatau-scan-"));
    const path = join(folder, "documento.jpg");
    try {
      await run(join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", script, "-OutputPath", path],
        { windowsHide: true, timeout: 90000, maxBuffer: 65536 });
    } catch (error) {
      if (error.code === 2) fail("Windows no detectó un escáner WIA. Revisa la conexión y el controlador de escaneo de HP.", 409);
      if (error.code === 3) fail("Windows detectó varios escáneres. Deja conectado el que vas a usar.", 409);
      fail("El escaneo no terminó. Revisa que la impresora esté encendida y que el documento esté en el cristal.", 409);
    }
    if ((await stat(path)).size > 20 * 1024 * 1024) fail("El escaneo supera 20 MB.", 413);
    const image = await readFile(path);
    if (image[0] !== 0xff || image[1] !== 0xd8) fail("El escáner no devolvió una imagen JPEG.", 409);
    res.type("image/jpeg").send(image);
  } finally {
    try {
      if (folder) {
        await rm(join(folder, "documento.jpg"), { force: true });
        await rmdir(folder);
      }
    } finally {
      scanning = false;
    }
  }
}
