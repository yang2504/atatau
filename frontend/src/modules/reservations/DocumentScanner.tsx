import { useEffect, useState } from "react";
import { ErrorBox } from "../../components/UI";

export function DocumentScanner() {
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);

  async function scan() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/scanner/document", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setImage(URL.createObjectURL(await response.blob()));
    } catch (error) {
      setError((error as Error).message || "No se pudo escanear el documento.");
    } finally {
      setBusy(false);
    }
  }

  return <details>
    <summary>Escanear documento</summary>
    <div className="form-stack">
      <p>Coloca el documento en el cristal. Puedes revisar y descargar el escaneo desde aquí.</p>
      <ErrorBox message={error} />
      <div className="row-actions">
        <button type="button" className="button secondary compact" disabled={busy} onClick={() => void scan()}>
          {busy ? "Escaneando…" : image ? "Volver a escanear" : "Iniciar escaneo"}
        </button>
        {image && <a className="button secondary compact" href={image} download="documento-escaneado.jpg">Descargar JPEG</a>}
      </div>
      {image && <img className="scan-preview" src={image} alt="Vista previa del documento escaneado" />}
    </div>
  </details>;
}
