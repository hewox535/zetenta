import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { data, error: err } = await signUp(email.trim(), password, {
      businessName: businessName.trim(),
      fullName: fullName.trim(),
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (!data.session) { setPendingEmail(true); return; } // confirmación de correo activada
    navigate('/', { replace: true });
  }

  if (pendingEmail) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">zetenta</div>
          <h1>Revisa tu correo</h1>
          <p className="auth-sub">Te enviamos un enlace para confirmar tu cuenta. Al confirmarla podrás iniciar sesión.</p>
          <p className="auth-alt"><Link to="/login">Volver a inicio de sesión</Link></p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">zetenta</div>
        <h1>Crea tu cuenta</h1>
        <p className="auth-sub">Registra tu negocio y empieza en minutos.</p>
        <form onSubmit={onSubmit} className="auth-form">
          <label>
            Nombre del negocio
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required autoFocus placeholder="Auto Vidrios Duglaris, C.A." />
          </label>
          <label>
            Tu nombre
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
          </label>
          <label>
            Correo electrónico
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label>
            Contraseña
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary lg" disabled={busy}>{busy ? 'Creando cuenta…' : 'Crear cuenta'}</button>
        </form>
        <p className="auth-alt">¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link></p>
      </div>
    </div>
  );
}
