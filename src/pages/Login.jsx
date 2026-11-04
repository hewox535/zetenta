import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import AuthLayout from '../components/AuthLayout';
import PasswordInput from '../components/PasswordInput';

export default function Login() {
  const { signIn } = useAuth();
  const { businessId } = useBranding();
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
      setError(err.message === 'Invalid login credentials' ? 'Usuario o contraseña incorrectos.' : err.message);
      return;
    }
    navigate('/', { replace: true });
  }

  return (
    <AuthLayout title="Inicia sesión" sub={businessId ? 'Entra con tu usuario o correo.' : 'Entra a tu tienda para vender, cobrar y cuadrar.'}>
        <form onSubmit={onSubmit} className="auth-form">
          <label>
            Usuario o correo
            <input value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" />
          </label>
          <label>
            Contraseña
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary lg" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <p className="auth-alt"><Link to="/forgot-password">¿Olvidaste tu contraseña?</Link></p>
        {!businessId && (
          <p className="auth-alt">¿Tu negocio aún no está en Zetenta? <Link to="/register">Crear cuenta</Link></p>
        )}
    </AuthLayout>
  );
}
