import { RoomRates } from "./RoomRates";
import { useEffect, useState, type FormEvent } from "react";
import type { Data, User } from "../../lib/types";
import { api, roleNames } from "../../lib/api";
import { ErrorBox, Icon, Modal } from "../../components/UI";
import { chatColor } from "../../lib/chatColor";
export function Settings({
  data,
  user,
  onSaved,
  onUserChanged,
  onPasswordChanged,
}: {
  data: Data;
  user: User;
  onSaved: () => Promise<void>;
  onUserChanged: (user: User) => void;
  onPasswordChanged: () => Promise<void>;
}) {
  const [users, setUsers] = useState<User[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<User | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [userNotice, setUserNotice] = useState("");
  const loadUsers = async () => setUsers(await api<User[]>("/users"));
  useEffect(() => {
    void loadUsers().catch((e) => setError(e.message));
  }, []);
  async function perform(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await onSaved();
      await loadUsers();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function addUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      v = new FormData(form);
    void perform(async () => {
      await api("/users", Object.fromEntries(v));
      setCreatingUser(false);
      setUserNotice(`Usuario creado: ${v.get("name")}.`);
    });
  }
  function addPlatform(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      v = new FormData(form);
    void perform(async () => {
      await api("/platforms", { name: v.get("name") });
      form.reset();
    });
  }
  function saveExchangeRate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get("exchange_rate"));
    const [whole, fraction = ""] = value.split(/[.,]/);
    const scaled_rate = Number(whole) * 10_000 + Number(fraction.padEnd(4, "0"));
    void perform(() => api("/lodging-exchange-rate", { scaled_rate }, "PUT"));
  }
  function editProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile) return;
    const values = new FormData(e.currentTarget);
    void perform(async () => {
      const result = await api<{ user: User }>(`/users/${profile.id}`, Object.fromEntries(values), "PATCH");
      if (profile.id === user.id) onUserChanged(result.user);
      setProfile(null);
    });
  }
  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !passwordUser) return;
    const values = new FormData(e.currentTarget);
    const password = values.get("password");
    if (password !== values.get("confirmation")) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/users/${passwordUser.id}/password`, { password }, "PATCH");
      setPasswordUser(null);
      if (passwordUser.id === user.id) await onPasswordChanged();
      else setUserNotice(`Contraseña actualizada para ${passwordUser.name}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!creatingUser && !profile && !passwordUser && <ErrorBox message={error} />}
      <div className="settings-grid">
        <section className="panel settings-panel">
          <span className="eyebrow">CANALES DE RESERVA</span>
          <h2>Plataformas</h2>
          <p className="muted">
            El canal se selecciona manualmente. Inhabilitarlo conserva las
            reservas anteriores.
          </p>
          <div className="setting-list">
            {data.platforms.map((p) => (
              <div key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <small>{p.active ? "Disponible" : "Inhabilitada"}</small>
                </div>
                {p.id !== 1 && (
                  <button
                    disabled={busy}
                    className="button secondary compact"
                    onClick={() =>
                      void perform(() =>
                        api(
                          `/platforms/${p.id}`,
                          { active: p.active ? 0 : 1 },
                          "PATCH",
                        ),
                      )
                    }
                  >
                    {p.active ? "Inhabilitar" : "Habilitar"}
                  </button>
                )}
              </div>
            ))}
          </div>
          <form className="inline-form" onSubmit={addPlatform}>
            <input
              name="name"
              aria-label="Nombre de plataforma"
              required
              maxLength={80}
              placeholder="Nueva plataforma"
            />
            <button className="button primary" disabled={busy}>
              Agregar
            </button>
          </form>
        </section>
        <section className="panel settings-panel">
          <span className="eyebrow">ACCESO AL SISTEMA</span>
          <div className="row-actions settings-team-heading">
            <h2>Equipo de Atatau</h2>
            <button type="button" className="button primary" disabled={busy} onClick={() => {
              setError(""); setUserNotice(""); setCreatingUser(true);
            }}><Icon name="plus" size={18} /> Nuevo usuario</button>
          </div>
          {userNotice && <p role="status">{userNotice}</p>}
          <div className="setting-list">
            {users.map((u) => (
              <div key={u.id}>
                <div>
                  <strong>
                    {u.name} {!u.active && "· Inactivo"}
                  </strong>
                  <small>
                    {u.username} · {roleNames[u.role]}
                  </small>
                </div>
                {(user.role === "superadmin" || u.role === "receptionist" || u.id === user.id) && (
                  <div className="row-actions">
                    <button className="button secondary compact" disabled={busy} onClick={() => {
                      setError("");
                      setProfile(u);
                    }}><Icon name="pencil" size={16} /> Editar perfil</button>
                    {user.role === "superadmin" && <button className="button secondary compact" disabled={busy} onClick={() => {
                      setError("");
                      setUserNotice("");
                      setPasswordUser(u);
                    }}>Cambiar contraseña</button>}
                    {u.id !== user.id && (
                    <button
                      disabled={busy}
                      className="button secondary compact"
                      onClick={() =>
                        void perform(() =>
                          api(
                            `/users/${u.id}`,
                            { active: u.active ? 0 : 1 },
                            "PATCH",
                          ),
                        )
                      }
                    >
                      {u.active ? "Desactivar" : "Activar"}
                    </button>
                    )}
                  </div>
                  )}
              </div>
            ))}
          </div>
        </section>
        <section className="panel settings-panel">
          <h2>Tipo de cambio para hospedaje</h2>
          <p className="muted">Las tarifas en USD se convierten con el tipo de cambio oficial del BCB. Configura un respaldo para cuando falte una cotización vigente.</p>
          <form className="form-stack" onSubmit={saveExchangeRate}>
            <label>Bolivianos por USD de respaldo
              <input name="exchange_rate" inputMode="decimal" required
                pattern="[0-9]{1,4}([.,][0-9]{1,4})?"
                key={data.lodgingExchangeRate}
                defaultValue={data.lodgingExchangeRate === null ? "" : data.lodgingExchangeRate / 10_000} />
            </label>
            <button className="button primary" disabled={busy}>Guardar tipo de cambio de respaldo</button>
          </form>
        </section>
        <RoomRates data={data} onSaved={onSaved} />
      </div>
      {creatingUser && <Modal title="Crear usuario" onClose={() => { if (!busy) { setCreatingUser(false); setError(""); } }}>
        <form onSubmit={addUser} className="form-stack">
          <ErrorBox message={error} />
          <div className="form-grid">
            <label>Nombre completo<input name="name" required maxLength={100} autoFocus /></label>
            <label>Nombre de usuario<input name="username" required maxLength={60} pattern={"[a-zA-Z0-9._\\-]+"} autoComplete="off" /></label>
          </div>
          <label>Contraseña<input name="password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required />
            <small className="muted">Usa al menos 10 caracteres.</small>
          </label>
          <label>Rol<select name="role">
            <option value="receptionist">Recepcionista</option>
            {user.role === "superadmin" && <>
              <option value="admin">Administradora</option>
              <option value="superadmin">Superadministrador</option>
            </>}
          </select></label>
          <div className="modal-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={() => { setCreatingUser(false); setError(""); }}>Cancelar</button>
            <button className="button primary" disabled={busy}>{busy ? "Creando…" : "Crear usuario"}</button>
          </div>
        </form>
      </Modal>}
      {profile && <Modal title={`Editar perfil · ${profile.name}`} onClose={() => { if (!busy) { setProfile(null); setError(""); } }}>
        <form className="form-stack" onSubmit={editProfile}>
          <ErrorBox message={error} />
          <label>Nombre<input name="name" autoFocus defaultValue={profile.name} required maxLength={100} /></label>
          <label>Usuario<input name="username" defaultValue={profile.username} required maxLength={60} pattern={"[a-zA-Z0-9._\\-]+"} /></label>
          <label>Color del chat<input type="color" name="chat_color" defaultValue={chatColor(profile.id, profile.chat_color)} /></label>
          <div className="modal-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={() => { setProfile(null); setError(""); }}>Cancelar</button>
            <button className="button primary" disabled={busy}>Guardar perfil</button>
          </div>
        </form>
      </Modal>}
      {passwordUser && <Modal title={`Cambiar contraseña · ${passwordUser.name}`}
        onClose={() => { if (!busy) { setPasswordUser(null); setError(""); } }}>
        <form className="form-stack" onSubmit={changePassword}>
          <ErrorBox message={error} />
          <p className="muted">Usa al menos 10 caracteres. Al guardar se cierran las sesiones de esta cuenta.</p>
          <label>Nueva contraseña
            <input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required autoFocus />
          </label>
          <label>Confirmar contraseña
            <input name="confirmation" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
          </label>
          <div className="modal-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={() => { setPasswordUser(null); setError(""); }}>Cancelar</button>
            <button className="button primary" disabled={busy}>{busy ? "Guardando…" : "Guardar contraseña"}</button>
          </div>
        </form>
      </Modal>}
    </>
  );
}
