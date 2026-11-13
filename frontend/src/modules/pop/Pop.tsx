import { useEffect, useState, type FormEvent } from "react";
import { ErrorBox, Icon, Modal } from "../../components/UI";
import { api, addDays, shortDate, today } from "../../lib/api";
import { nameMatches, reservationMatches } from "../../lib/guestSearch";
import { occupiedUnits } from "../../lib/lodging";
import { cents, money, paymentMethods } from "../../lib/money";
import { CardCharge } from "../../components/CardCharge";
import type { Data, User } from "../../lib/types";

type Product = { id: number; name: string; stock: number; price_cents: number; active: number; category_id: number | null; low_stock: number; photo_revision: string | null };
type Category = { id: number; name: string };
type Movement = { id: number; day: string; kind: "sale" | "in" | "out"; detail: string; quantity: number; author: string; folio_id: number | null; folio_title: string | null };
const movementNames = { sale: "Venta", in: "Entrada", out: "Baja" };

const imageUrl = (product: Product) => `/api/pub/${product.id}/photo?v=${product.photo_revision}`;
const low = (product: Product) => !!product.active && product.stock <= product.low_stock;

async function preparePhoto(file: File) {
  if (file.size > 15 * 1024 * 1024) throw new Error("Elige una imagen de hasta 15 MB.");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("No se pudo abrir la imagen. Prueba con JPG, PNG o WebP."); });
  try {
    const canvas = document.createElement("canvas");
    const ratio = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.65, 0.45, 0.25]) {
      const image = canvas.toDataURL("image/jpeg", quality);
      if (image.length - "data:image/jpeg;base64,".length <= 273064) return image;
    }
    throw new Error("La foto comprimida supera 200 KB. Elige otra imagen.");
  } finally { bitmap.close(); }
}

export function Pop({ user, data, onSaved }: { user: User; data: Data; onSaved: () => Promise<void> }) {
  const admin = user.role !== "receptionist";
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<number | "all" | "none">("all");
  const [managingCategories, setManagingCategories] = useState(false);
  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [edit, setEdit] = useState<Product | null>(null);
  const [editingProduct, setEditingProduct] = useState(false);
  const [photo, setPhoto] = useState<string | null | undefined>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [folioSearch, setFolioSearch] = useState("");
  const [folioId, setFolioId] = useState("");
  const [ready, setReady] = useState(false);
  const [kind, setKind] = useState("sale");
  const [method, setMethod] = useState("Efectivo");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const base = (selected?.price_cents ?? 0) * quantity;
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const catalog = products.filter((product) => admin || product.active);
  const alerts = catalog.filter(low);
  const visibleProducts = catalog.filter((product) => (!lowOnly || low(product)) && nameMatches(search, product.name) &&
    (categoryFilter === "all" || product.category_id === (categoryFilter === "none" ? null : categoryFilter)));
  const day = today();
  const guestFolios = data.folios.filter((item) => item.status === "in_house" &&
    (item.joined_on ?? item.check_in) <= day && item.check_out >= day);
  const matchingFolios = guestFolios.flatMap((item) => {
    const reservation = data.reservations.find((r) => r.id === item.reservation_id);
    const night = item.check_out === day ? addDays(day, -1) : day;
    const units = item.extra_unit_id ? [item.extra_unit_id] : reservation ? occupiedUnits(reservation, night, addDays(night, 1)) : [];
    const rooms = data.rooms.filter((room) => room.units.some((unit) => units.includes(unit.id))).map((room) => room.name);
    if (String(item.id) === folioId || nameMatches(folioSearch, item.title, item.guest_name, ...rooms, `#${item.reservation_id}`) ||
        (item.guest_id === null && reservation && reservationMatches(folioSearch, reservation)))
      return [{ ...item, location: rooms.join(", ") || item.room_name }];
    return [];
  });

  async function load() {
    const [items, history, groups] = await Promise.all([
      api<Product[]>("/pub"), api<Movement[]>("/pub/movements"), api<Category[]>("/pub/categories"),
    ]);
    setProducts(items);
    setMovements(history);
    setCategories(groups);
    setReady(true);
    setCategoryFilter((current) => typeof current === "number" && !groups.some((group) => group.id === current) ? "all" : current);
    setSelected((current) => items.find((item) => item.id === current?.id) ?? null);
  }
  useEffect(() => { void load().catch((error) => setError(error.message)); }, []);

  function openProduct(product: Product | null) {
    setEdit(product);
    setPhoto(undefined);
    setError("");
    setEditingProduct(true);
  }

  function openMovement(product: Product, operation: string) {
    setError("");
    setSelected(product);
    setKind(operation);
    setQuantity(1);
    setMethod("Efectivo");
    setFolioSearch("");
    setFolioId("");
  }

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
        low_stock: Number(values.get("low_stock")),
        photo: photo?.split(",")[1] ?? photo,
      }, edit ? "PATCH" : "POST");
      form.reset();
      setEdit(null);
      setEditingProduct(false);
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
      const result = await api<{ collected_cents: number; folio_id: number | null }>(`/pub/${selected.id}/movements`, {
        kind, quantity, method: method === "debt" ? undefined : method,
        folio_id: kind === "sale" && method === "debt" ? Number(folioId) : undefined,
        detail: values.get("detail"), base_cents: base,
      });
      form.reset();
      setQuantity(1);
      setSelected(null);
      setSuccess(result.folio_id ? `Consumo de ${money(base)} cargado a la hoja #${result.folio_id}.`
        : kind === "sale" ? `Venta registrada · ${money(result.collected_cents)}` : "Stock actualizado.");
      if (result.folio_id) await onSaved();
    });
  }

  return <div className="form-stack pub-workspace">
    {!managingCategories && !selected && !editingProduct && <ErrorBox message={error} />}
    {!managingCategories && success && <p className="group-booking-summary" role="status">{success}</p>}
        <section className="panel pub-catalog">
          <div className="section-toolbar pop-catalog-toolbar">
            <div><h2>Catálogo de venta</h2><p className="muted">Elige un producto para cobrar o cargar a una hoja de consumo.</p></div>
            {admin && <div className="row-actions"><button className="button secondary" onClick={() => {
              setEditCategory(null); setError(""); setSuccess(""); setManagingCategories(true);
            }}>Administrar categorías</button>
              <button className="button primary" onClick={() => openProduct(null)}><Icon name="plus" size={16} /> Agregar producto</button>
            </div>}
          </div>
          <div className="pub-filters">
            <label>Buscar producto<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre del producto" /></label>
            <button type="button" className={`button secondary pub-stock-toggle${lowOnly ? " selected" : ""}`}
              aria-pressed={lowOnly} onClick={() => { setLowOnly(!lowOnly); setCategoryFilter("all"); setSearch(""); }}>
              Stock bajo o agotado · {alerts.length}
            </button>
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
          {!ready && !error && <p className="quiet-state" role="status">Cargando catálogo…</p>}
          {ready && !visibleProducts.length && <p className="quiet-state">{catalog.length ? "No hay productos con estos filtros." : "El catálogo todavía está vacío."}</p>}
          <div className="pub-products">{visibleProducts.map((product) => <article className="pub-product" key={product.id}>
            <div className="pub-product-image">
              {product.photo_revision ? <img src={imageUrl(product)} alt="" loading="lazy" />
                : <Icon name="box" size={38} />}
            </div>
            <div className="pub-product-body">
              <small>{categoryNames.get(product.category_id ?? 0) ?? "Sin categoría"}</small>
              <h3>{product.name}</h3>
              <div className="pub-product-figures"><strong>{money(product.price_cents)}</strong>
                <span className={low(product) ? "pub-stock-alert" : undefined}>
                  {!product.active ? "Inactivo" : !product.stock ? "Agotado" : low(product) ? `Bajo stock · ${product.stock} u.` : `${product.stock} u.`}
                </span>
              </div>
              <button className="button primary" aria-label={`Vender ${product.name}`}
                disabled={busy || !product.stock || !product.active} onClick={() => openMovement(product, "sale")}>Vender</button>
              {admin && <div className="row-actions pub-product-actions">
                <button className="text-button" aria-label={`Editar ${product.name}`} disabled={busy} onClick={() => openProduct(product)}>Editar</button>
                <button className="text-button" aria-label={`Mover stock de ${product.name}`} disabled={busy}
                  onClick={() => openMovement(product, product.active ? "in" : "out")}>Mover stock</button>
              </div>}
            </div>
          </article>)}</div>
        </section>
        <section className="panel">
          <div className="section-toolbar"><h2>Movimientos recientes</h2></div>
          {!movements.length && <p className="quiet-state">Todavía no se registraron movimientos.</p>}
          {!!movements.length && <div className="table-scroll"><table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Unidades</th></tr></thead>
            <tbody>{movements.map((entry) => <tr key={entry.id}>
              <td>{shortDate(entry.day)}</td><td>{entry.folio_id ? "A cuenta" : movementNames[entry.kind]}</td>
              <td>{entry.detail}<small className="cell-sub">{entry.folio_id ? `Hoja #${entry.folio_id} · ${entry.folio_title} · ` : ""}{entry.author}</small></td><td>{entry.quantity}</td>
            </tr>)}</tbody>
          </table></div>}
        </section>
        {selected && <Modal title={kind === "sale" ? `Vender · ${selected.name}` : `Mover stock · ${selected.name}`}
          className="pub-dialog" onClose={() => { if (!busy) { setSelected(null); setError(""); } }}>
          <ErrorBox message={error} />
          <p className="muted">{selected.stock} disponibles · {money(selected.price_cents)} por unidad</p>
          <form className="form-stack" onSubmit={move} key={selected.id}>
            {admin && kind !== "sale" && <label>Movimiento<select value={kind} onChange={(e) => { setKind(e.target.value); setQuantity(1); }}>
              {selected.active === 1 && <option value="in">Entrada de stock</option>}
              <option value="out">Baja de stock</option>
            </select></label>}
            <label>Unidades<input type="number" min={1} max={kind === "in" ? 1000000 - selected.stock : selected.stock} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required /></label>
            {kind === "sale" ? <>
              <label>Medio de pago<select value={method} onChange={(e) => setMethod(e.target.value)}>
                {paymentMethods.map((item) => <option key={item}>{item}</option>)}
                <option value="debt">A cuenta del huésped</option>
              </select></label>
              {method === "debt" && <>
                <label>Buscar huésped o habitación<input type="search" value={folioSearch} onChange={(e) => { setFolioSearch(e.target.value); setFolioId(""); }} /></label>
                <label>Hoja de consumo<select value={folioId} required onChange={(e) => setFolioId(e.target.value)}>
                  <option value="">{matchingFolios.length ? "Selecciona una hoja" : "Sin hojas de huéspedes alojados"}</option>
                  {matchingFolios.map((item) => <option key={item.id} value={item.id}>{item.title}{item.location && ` · ${item.location}`} · Hoja #{item.id}</option>)}
                </select></label>
              </>}
              {method === "Tarjeta" ? <CardCharge base={base} /> : <p className="group-booking-summary"><strong>
                {method === "debt" ? "Total a la hoja" : "Total a cobrar"} · {money(base)}
              </strong></p>}
            </> : <label>Motivo<input name="detail" maxLength={160} required /></label>}
            <div className="modal-actions">
              <button type="button" className="button secondary" disabled={busy} onClick={() => { setSelected(null); setError(""); }}>Cancelar</button>
              <button className="button primary" disabled={busy || (!selected.stock && kind !== "in") || (method === "debt" && !folioId)}>
                {kind !== "sale" ? "Registrar movimiento" : method === "debt" ? "Cargar a la hoja" : "Registrar venta"}
              </button>
            </div>
          </form>
        </Modal>}
        {editingProduct && <Modal title={edit ? "Editar producto" : "Agregar producto"} className="pub-dialog"
          onClose={() => { if (!busy && !photoBusy) { setEditingProduct(false); setError(""); } }}>
          <ErrorBox message={error} />
          <form className="form-stack" onSubmit={saveProduct} key={edit?.id ?? "new"}>
            <label>Nombre<input name="name" defaultValue={edit?.name} placeholder="Ej. Powerade" maxLength={100} required /></label>
            <div className="form-grid">
              <label>Precio unitario (Bs)<input name="price" inputMode="decimal" pattern="[0-9]{1,7}([.,][0-9]{1,2})?" defaultValue={edit ? (edit.price_cents / 100).toFixed(2) : ""} required /></label>
              <label>Umbral de stock bajo (unidades)<input name="low_stock" type="number" min={0} max={1000000} defaultValue={edit?.low_stock ?? 3} required /></label>
            </div>
            <label>Categoría<select name="category" key={edit?.category_id ?? "none"} defaultValue={edit?.category_id ?? ""}>
              <option value="">Sin categoría</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select></label>
            <label>Foto del producto<input type="file" accept="image/jpeg,image/png,image/webp" disabled={photoBusy || busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                e.target.value = "";
                setPhotoBusy(true);
                setError("");
                try { setPhoto(await preparePhoto(file)); } catch (error) { setError((error as Error).message); }
                finally { setPhotoBusy(false); }
              }} /></label>
            {photoBusy && <p role="status">Preparando foto…</p>}
            {(photo || (photo === undefined && edit?.photo_revision)) && <div className="row-actions">
              <img className="pub-photo-preview" src={photo ?? imageUrl(edit!)} alt="Vista previa del producto" />
              <button type="button" className="text-button" disabled={busy || photoBusy} onClick={() => setPhoto(null)}>Quitar foto</button>
            </div>}
            <label className="bed-option"><input name="active" type="checkbox" defaultChecked={edit ? !!edit.active : true} /> Producto activo</label>
            <div className="modal-actions">
              <button type="button" className="button secondary" disabled={busy || photoBusy} onClick={() => { setEditingProduct(false); setError(""); }}>Cancelar</button>
              <button className="button primary" disabled={busy || photoBusy}>Guardar producto</button>
            </div>
          </form>
        </Modal>}
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
