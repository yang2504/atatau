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
}: {
  data: Data;
  user: User;
  onSaved: () => Promise<void>;
  onUserChanged: (user: User) => void;
}) {
  const [users, setUsers] = useState<User[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<User | null>(null);
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
  return (
    <>
      <ErrorBox message={error} />
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
    </>
  );
}
