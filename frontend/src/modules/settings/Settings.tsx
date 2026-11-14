import { RoomRates } from "./RoomRates";
import { useEffect, useState, type FormEvent } from "react";
import type { Data, User } from "../../lib/types";
import { api, roleNames } from "../../lib/api";
import { ErrorBox, Modal } from "../../components/UI";
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
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [passwordNotice, setPasswordNotice] = useState("");
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
      form.reset();
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
      else setPasswordNotice(`Contraseña actualizada para ${passwordUser.name}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!profile && !passwordUser && <ErrorBox message={error} />}
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
          <h2>Equipo de Atatau</h2>
          {passwordNotice && <p role="status">{passwordNotice}</p>}
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
                    }}>Editar perfil</button>
                    {user.role === "superadmin" && <button className="button secondary compact" disabled={busy} onClick={() => {
                      setError("");
                      setPasswordNotice("");
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
          <h3>Crear usuario</h3>
          <form onSubmit={addUser} className="form-stack">
            <div className="form-grid">
              <label>
                Nombre
                <input name="name" required maxLength={100} />
              </label>
              <label>
                Usuario
                <input
                  name="username"
                  required
                  maxLength={60}
                  pattern={"[a-zA-Z0-9._\\-]+"}
                />
              </label>
            </div>
            <label>
              Contraseña
              <input
                name="password"
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Rol
              <select name="role">
                <option value="receptionist">Recepcionista</option>
                {user.role === "superadmin" && (
                  <>
                    <option value="admin">Administradora</option>
                    <option value="superadmin">Superadministrador</option>
                  </>
                )}
              </select>
            </label>
            <button disabled={busy} className="button primary">
              Crear usuario
            </button>
          </form>
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
      {profile && <Modal title={`Editar perfil · ${profile.name}`} onClose={() => setProfile(null)}>
        <form className="form-stack" onSubmit={editProfile}>
          <ErrorBox message={error} />
          <label>Nombre<input name="name" autoFocus defaultValue={profile.name} required maxLength={100} /></label>
          <label>Usuario<input name="username" defaultValue={profile.username} required maxLength={60} pattern={"[a-zA-Z0-9._\\-]+"} /></label>
          <label>Color del chat<input type="color" name="chat_color" defaultValue={chatColor(profile.id, profile.chat_color)} /></label>
          <button className="button primary" disabled={busy}>Guardar perfil</button>
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
          <button className="button primary" disabled={busy}>{busy ? "Guardando…" : "Guardar contraseña"}</button>
        </form>
      </Modal>}
    </>
  );
}
