import { useEffect, useState, type FormEvent } from "react";
import { ErrorBox } from "../../components/UI";
import { api, shortDate } from "../../lib/api";
import { cents, money, paymentMethods } from "../../lib/money";
import { CardCharge } from "../../components/CardCharge";
import type { User } from "../../lib/types";

type Product = { id: number; name: string; stock: number; price_cents: number; active: number };
type Movement = { id: number; day: string; kind: "sale" | "in" | "out"; detail: string; quantity: number; author: string };
const movementNames = { sale: "Venta", in: "Entrada", out: "Baja" };

export function Pop({ user }: { user: User }) {
  const admin = user.role !== "receptionist";
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [edit, setEdit] = useState<Product | null>(null);
  const [kind, setKind] = useState("sale");
  const [method, setMethod] = useState("Efectivo");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const base = (selected?.price_cents ?? 0) * quantity;

  async function load() {
    const [items, history] = await Promise.all([api<Product[]>("/pub"), api<Movement[]>("/pub/movements")]);
    setProducts(items);
    setMovements(history);
    setSelected((current) => items.find((item) => item.id === current?.id) ?? null);
  }
  useEffect(() => { void load().catch((error) => setError(error.message)); }, []);

  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await work();
    } catch (error) {
      setError((error as Error).message);
    }
    try {
      await load();
    } catch (error) {
      setError((current) => current || (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void perform(async () => {
      await api(edit ? `/pub/${edit.id}` : "/pub", {
        name: values.get("name"),
        price_cents: cents(String(values.get("price"))),
        active: values.has("active") ? 1 : 0,
      }, edit ? "PATCH" : "POST");
      form.reset();
      setEdit(null);
      setSuccess("Producto guardado.");
    });
  }

  function move(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    void perform(async () => {
      const result = await api<{ collected_cents: number }>(`/pub/${selected.id}/movements`, {
        kind, quantity, method, detail: values.get("detail"), base_cents: base,
      });
      form.reset();
      setQuantity(1);
      setSuccess(kind === "sale" ? `Venta registrada · ${money(result.collected_cents)}` : "Stock actualizado.");
    });
  }

  return <div className="form-stack">
    <ErrorBox message={error} />
    {success && <p className="form-note" role="status">{success}</p>}
    <div className="content-columns operations-layout">
      <div className="form-stack">
        <section className="panel">
          <div className="section-toolbar"><h2>Productos <span className="count">{products.length}</span></h2></div>
          {!products.length && <p className="quiet-state">El catálogo todavía está vacío.</p>}
          {!!products.length && <div className="table-scroll"><table>
            <thead><tr><th>Producto</th><th>Precio unitario</th><th>Stock</th><th>Acciones</th></tr></thead>
            <tbody>{products.map((product) => <tr key={product.id}>
              <td><strong>{product.name}</strong>{!product.active && <small className="cell-sub">Inactivo</small>}</td>
              <td>{money(product.price_cents)}</td>
              <td>{product.stock} u.</td>
              <td><div className="row-actions">
                {(product.active || admin) && <button className="text-button" disabled={busy || (!admin && !product.stock)} onClick={() => { setSelected(product); setQuantity(1); setMethod("Efectivo"); setKind(admin ? product.active ? "in" : "out" : "sale"); }}>{admin ? "Mover stock" : "Vender"}</button>}
                {admin && <button className="text-button" disabled={busy} onClick={() => setEdit(product)}>Editar</button>}
              </div></td>
            </tr>)}</tbody>
          </table></div>}
        </section>
        <section className="panel">
          <div className="section-toolbar"><h2>Movimientos recientes</h2></div>
          {!movements.length && <p className="quiet-state">Todavía no se registraron movimientos.</p>}
          {!!movements.length && <div className="table-scroll"><table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Unidades</th></tr></thead>
            <tbody>{movements.map((entry) => <tr key={entry.id}>
              <td>{shortDate(entry.day)}</td><td>{movementNames[entry.kind]}</td>
              <td>{entry.detail}<small className="cell-sub">{entry.author}</small></td><td>{entry.quantity}</td>
            </tr>)}</tbody>
          </table></div>}
        </section>
      </div>
      <aside className="form-stack">
        {selected && <section className="panel side-form">
          <h2>{selected.name}</h2><p className="muted">{selected.stock} disponibles</p>
          <form className="form-stack" onSubmit={move} key={selected.id}>
            {admin && <label>Movimiento<select value={kind} onChange={(e) => { setKind(e.target.value); setQuantity(1); }}>
              {selected.active === 1 && <><option value="in">Entrada de stock</option><option value="sale">Venta</option></>}
              <option value="out">Baja de stock</option>
            </select></label>}
            <label>Unidades<input type="number" min={1} max={kind === "in" ? 1000000 - selected.stock : selected.stock} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required /></label>
            {kind === "sale" ? <>
              <label>Medio de pago<select value={method} onChange={(e) => setMethod(e.target.value)}>{paymentMethods.map((item) => <option key={item}>{item}</option>)}</select></label>
              {method === "Tarjeta" ? <CardCharge base={base} /> : <p className="form-note">Total a cobrar {money(base)}</p>}
            </> : <label>Motivo<input name="detail" maxLength={160} required /></label>}
            <button className="button primary" disabled={busy || (!selected.stock && kind !== "in")}>{kind === "sale" ? "Registrar venta" : "Registrar movimiento"}</button>
            <button type="button" className="text-button" onClick={() => setSelected(null)}>Cerrar movimiento</button>
          </form>
        </section>}
        {admin && <section className="panel side-form">
          <h2>{edit ? "Editar producto" : "Nuevo producto"}</h2>
          <form className="form-stack" onSubmit={saveProduct} key={edit?.id ?? "new"}>
            <label>Nombre<input name="name" defaultValue={edit?.name} placeholder="Ej. Powerade" maxLength={100} required /></label>
            <label>Precio unitario (Bs)<input name="price" inputMode="decimal" pattern="[0-9]{1,7}([.,][0-9]{1,2})?" defaultValue={edit ? (edit.price_cents / 100).toFixed(2) : ""} required /></label>
            <label className="bed-option"><input name="active" type="checkbox" defaultChecked={edit ? !!edit.active : true} /> Producto activo</label>
            <button className="button primary" disabled={busy}>Guardar producto</button>
            {edit && <button type="button" className="text-button" onClick={() => setEdit(null)}>Cerrar edición</button>}
          </form>
        </section>}
        {!admin && !selected && <p className="panel side-form muted">Selecciona un producto con stock para registrar una venta.</p>}
      </aside>
    </div>
  </div>;
}
