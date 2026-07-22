import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await signIn(email.trim(), password);
    setBusy(false);
    if (err) {
      setError(err.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : err.message);
      return;
    }
    navigate('/', { replace: true });
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">zetenta</div>
        <h1>Inicia sesión</h1>
        <p className="auth-sub">Tus cuentas, de la A a la Z.</p>
        <form onSubmit={onSubmit} className="auth-form">
          <label>
            Correo electrónico
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="email" />
          </label>
          <label>
            Contraseña
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary lg" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <p className="auth-alt"><Link to="/forgot-password">¿Olvidaste tu contraseña?</Link></p>
        <p className="auth-alt">¿Tu negocio aún no está en Zetenta? <Link to="/register">Crear cuenta</Link></p>
      </div>
    </div>
  );
}
