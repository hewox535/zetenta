import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';

export default function Register() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('general');
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
      businessType,
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
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required autoFocus placeholder="Mi Negocio, C.A." />
          </label>
          <label>
            Tipo de negocio
            <select value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
              <option value="general">General</option>
              <option value="ropa">Tienda de ropa / moda</option>
            </select>
            <span className="field-hint">
              {businessType === 'ropa'
                ? 'Te dejamos listas las tallas (S–XXL) y colores comunes como variaciones.'
                : 'Empiezas con Marca y Modelo; puedes configurar variaciones luego.'}
            </span>
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
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
            <span className="field-hint">Mínimo 8 caracteres.</span>
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary lg" disabled={busy}>{busy ? 'Creando cuenta…' : 'Crear cuenta'}</button>
        </form>
        <p className="auth-alt">¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link></p>
      </div>
    </div>
  );
}
