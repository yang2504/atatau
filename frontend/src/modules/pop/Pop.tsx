import { useEffect, useState, type FormEvent } from "react";
import { ErrorBox, Modal } from "../../components/UI";
import { api, shortDate } from "../../lib/api";
import { cents, money, paymentMethods } from "../../lib/money";
import { CardCharge } from "../../components/CardCharge";
import type { User } from "../../lib/types";

type Product = { id: number; name: string; stock: number; price_cents: number; active: number; category_id: number | null };
type Category = { id: number; name: string };
type Movement = { id: number; day: string; kind: "sale" | "in" | "out"; detail: string; quantity: number; author: string };
const movementNames = { sale: "Venta", in: "Entrada", out: "Baja" };

export function Pop({ user }: { user: User }) {
  const admin = user.role !== "receptionist";
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<number | "all" | "none">("all");
  const [managingCategories, setManagingCategories] = useState(false);
  const [editCategory, setEditCategory] = useState<Category | null>(null);
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
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const visibleProducts = categoryFilter === "all" ? products :
    products.filter((product) => product.category_id === (categoryFilter === "none" ? null : categoryFilter));

  async function load() {
    const [items, history, groups] = await Promise.all([
      api<Product[]>("/pub"), api<Movement[]>("/pub/movements"), api<Category[]>("/pub/categories"),
    ]);
    setProducts(items);
    setMovements(history);
    setCategories(groups);
    setCategoryFilter((current) => typeof current === "number" && !groups.some((group) => group.id === current) ? "all" : current);
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
        category_id: values.get("category") ? Number(values.get("category")) : null,
      }, edit ? "PATCH" : "POST");
      form.reset();
      setEdit(null);
      setSuccess("Producto guardado.");
    });
  }

  function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get("name");
    void perform(async () => {
      await api(editCategory ? `/pub/categories/${editCategory.id}` : "/pub/categories",
        { name }, editCategory ? "PATCH" : "POST");
      form.reset();
      setEditCategory(null);
      setSuccess("Categoría guardada.");
    });
  }

  function removeCategory(category: Category) {
    if (!window.confirm(`¿Eliminar «${category.name}»? Sus productos pasarán a Sin categoría y conservarán su stock e historial.`)) return;
    void perform(async () => {
      await api(`/pub/categories/${category.id}`, {}, "DELETE");
      setEditCategory(null);
      setEdit((current) => current?.category_id === category.id ? { ...current, category_id: null } : current);
      setSuccess("Categoría eliminada.");
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
    {!managingCategories && <ErrorBox message={error} />}
    {!managingCategories && success && <p className="form-note" role="status">{success}</p>}
    <div className="content-columns operations-layout">
      <div className="form-stack">
        <section className="panel">
          <div className="section-toolbar pop-catalog-toolbar">
            <h2>Productos <span className="count">{visibleProducts.length}</span></h2>
            {admin && <button className="button secondary compact" onClick={() => {
              setEditCategory(null); setError(""); setSuccess(""); setManagingCategories(true);
            }}>Administrar categorías</button>}
          </div>
          <div className="tabs pop-category-tabs" role="group" aria-label="Categorías de productos">
            <button type="button" className={categoryFilter === "all" ? "active" : ""}
              aria-pressed={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>Todos</button>
            {categories.map((category) => <button key={category.id} type="button"
              className={categoryFilter === category.id ? "active" : ""} aria-pressed={categoryFilter === category.id}
              onClick={() => setCategoryFilter(category.id)}>{category.name}</button>)}
            <button type="button" className={categoryFilter === "none" ? "active" : ""}
              aria-pressed={categoryFilter === "none"} onClick={() => setCategoryFilter("none")}>Sin categoría</button>
          </div>
          {!products.length && <p className="quiet-state">El catálogo todavía está vacío.</p>}
          {!!products.length && !visibleProducts.length && <p className="quiet-state">Esta categoría todavía no tiene productos.</p>}
          {!!visibleProducts.length && <div className="table-scroll"><table>
            <thead><tr><th>Producto</th><th>Precio unitario</th><th>Stock</th><th>Acciones</th></tr></thead>
            <tbody>{visibleProducts.map((product) => <tr key={product.id}>
              <td><strong>{product.name}</strong>
                <small className="cell-sub">{categoryNames.get(product.category_id ?? 0) ?? "Sin categoría"}{!product.active && " · Inactivo"}</small>
              </td>
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
            <label>Categoría<select name="category" key={edit?.category_id ?? "none"} defaultValue={edit?.category_id ?? ""}>
              <option value="">Sin categoría</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select></label>
            <label className="bed-option"><input name="active" type="checkbox" defaultChecked={edit ? !!edit.active : true} /> Producto activo</label>
            <button className="button primary" disabled={busy}>Guardar producto</button>
            {edit && <button type="button" className="text-button" onClick={() => setEdit(null)}>Cerrar edición</button>}
          </form>
        </section>}
        {!admin && !selected && <p className="panel side-form muted">Selecciona un producto con stock para registrar una venta.</p>}
      </aside>
    </div>
    {managingCategories && <Modal title="Categorías del Pub" onClose={() => setManagingCategories(false)}>
      <ErrorBox message={error} />
      {success && <p className="form-note" role="status">{success}</p>}
      {categories.length > 0 && <ul className="pop-category-list">
        {categories.map((category) => <li key={category.id}>
          <strong>{category.name}</strong>
          <div className="row-actions">
            <button type="button" className="button secondary compact" disabled={busy}
              onClick={() => { setEditCategory(category); setError(""); setSuccess(""); }}>Editar</button>
            <button type="button" className="text-button" disabled={busy} onClick={() => removeCategory(category)}>Eliminar</button>
          </div>
        </li>)}
      </ul>}
      <form className="form-stack" key={editCategory?.id ?? "new"} onSubmit={saveCategory}>
        <label>{editCategory ? "Editar nombre de categoría" : "Nueva categoría"}
          <input name="name" defaultValue={editCategory?.name} placeholder="Ej. Bebidas" maxLength={60} required />
        </label>
        <div className="row-actions">
          <button className="button primary" disabled={busy}>{editCategory ? "Guardar cambios" : "Agregar categoría"}</button>
          {editCategory && <button type="button" className="button secondary" disabled={busy}
            onClick={() => setEditCategory(null)}>Cancelar</button>}
        </div>
      </form>
    </Modal>}
  </div>;
}
