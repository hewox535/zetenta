import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { updateMyProfile, updateMyEmail, updateMyPassword } from '../lib/api';
import PasswordInput from '../components/PasswordInput';

// Configuración de la cuenta del usuario en sesión (todos los roles): nombre
// visible, nombre de usuario, correo y contraseña. La configuración del
// negocio vive aparte en /settings.
export default function Account() {
  const { profile, refreshProfile } = useAuth();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Mi cuenta</h1>
          <p className="page-sub">Tu perfil y credenciales de acceso.</p>
        </div>
      </header>
      <div className="vform">
        <ProfileSection profile={profile} refreshProfile={refreshProfile} />
        <EmailSection profile={profile} refreshProfile={refreshProfile} />
        <PasswordSection />
      </div>
    </div>
  );
}

function ProfileSection({ profile, refreshProfile }) {
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [username, setUsername] = useState(profile?.username || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null); setOk(null); setBusy(true);
    try {
      await updateMyProfile(profile.id, { fullName, username });
      await refreshProfile();
      setOk('Perfil actualizado.');
    } catch (err) {
      setError(err.message.includes('profiles_username_key') ? 'Ese nombre de usuario ya está en uso.'
        : err.message.includes('username') && err.message.includes('check') ? 'Usuario inválido: 3–30 caracteres, letras/números y . _ - (sin espacios).'
        : err.message);
    } finally { setBusy(false); }
  }

  return (
    <section className="card vsection">
      <h2>Perfil</h2>
      <form onSubmit={onSubmit} className="vform">
        <div className="vgrid">
          <label>
            Nombre
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Tu nombre" />
          </label>
          <label>
            Nombre de usuario
            <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="mi-usuario" autoComplete="username" spellCheck={false} />
            <span className="hint">Sirve para iniciar sesión sin correo. Opcional.</span>
          </label>
        </div>
        {error && <div className="form-error">{error}</div>}
        {ok && <div className="form-ok">{ok}</div>}
        <div className="inline-form-actions">
          <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </section>
  );
}

function EmailSection({ profile, refreshProfile }) {
  const [email, setEmail] = useState(profile?.email || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null); setOk(null); setBusy(true);
    try {
      await updateMyEmail(profile.id, email.trim().toLowerCase());
      await refreshProfile();
      setOk('Te enviamos un enlace de confirmación al correo nuevo. El cambio se completa al confirmarlo; mientras tanto sigues entrando con tus credenciales actuales.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <section className="card vsection">
      <h2>Correo electrónico</h2>
      {!profile?.email && (
        <p className="hint">Tu cuenta no tiene correo asociado; agregar uno te permite recuperar la contraseña.</p>
      )}
      <form onSubmit={onSubmit} className="vform">
        <label>
          Correo
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            placeholder="tu@correo.com" autoComplete="email" />
        </label>
        {error && <div className="form-error">{error}</div>}
        {ok && <div className="form-ok">{ok}</div>}
        <div className="inline-form-actions">
          <button className="btn primary" disabled={busy || email.trim().toLowerCase() === (profile?.email || '')}>
            {busy ? 'Guardando…' : (profile?.email ? 'Cambiar correo' : 'Agregar correo')}
          </button>
        </div>
      </form>
    </section>
  );
}

function PasswordSection() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null); setOk(null);
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return; }
    setBusy(true);
    try {
      await updateMyPassword(password);
      setPassword(''); setConfirm('');
      setOk('Contraseña actualizada.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <section className="card vsection">
      <h2>Contraseña</h2>
      <form onSubmit={onSubmit} className="vform">
        <div className="vgrid">
          <label>
            Nueva contraseña
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
            <span className="hint">Mínimo 8 caracteres.</span>
          </label>
          <label>
            Repite la contraseña
            <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
          </label>
        </div>
        {error && <div className="form-error">{error}</div>}
        {ok && <div className="form-ok">{ok}</div>}
        <div className="inline-form-actions">
          <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Cambiar contraseña'}</button>
        </div>
      </form>
    </section>
  );
}
