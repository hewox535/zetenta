import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';
import AuthLayout from '../components/AuthLayout';

const BUSINESS_TYPES = [
  { value: 'general', label: 'Comercio general', hint: 'Empiezas con Marca y Modelo; las variaciones las configuras luego.' },
  { value: 'ropa', label: 'Ropa y moda', hint: 'Te dejamos listas las tallas (S–XXL) y colores comunes.' },
];

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
      <AuthLayout title="Revisa tu correo" sub="Te enviamos un enlace para confirmar tu cuenta. Al confirmarla podrás iniciar sesión.">
        <p className="auth-alt"><Link to="/login">Volver a inicio de sesión</Link></p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Crea tu cuenta" sub="Registra tu tienda y haz tu primera venta hoy.">
        <form onSubmit={onSubmit} className="auth-form">
          <label>
            Nombre del negocio
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required autoFocus placeholder="Mi Negocio, C.A." />
          </label>
          <div className="auth-type" role="radiogroup" aria-label="Tipo de negocio">
            <span className="ztype-title">Tipo de negocio</span>
            <div className="ztype">
              {BUSINESS_TYPES.map((t) => (
                <label className="ztype-opt" key={t.value}>
                  <input type="radio" name="businessType" value={t.value}
                    checked={businessType === t.value} onChange={() => setBusinessType(t.value)} />
                  <span className="ztype-card"><b>{t.label}</b><em>{t.hint}</em></span>
                </label>
              ))}
            </div>
          </div>
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
    </AuthLayout>
  );
}
