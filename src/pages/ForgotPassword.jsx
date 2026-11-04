import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import AuthLayout from '../components/AuthLayout';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
  }

  return (
    <AuthLayout
      title="Recuperar contraseña"
      sub={sent
        ? <>Si <strong>{email}</strong> está registrado, en unos minutos recibirás un correo con un enlace para crear una contraseña nueva. Revisa también la carpeta de spam.</>
        : 'Escribe tu correo y te enviaremos un enlace para crear una contraseña nueva.'}
    >
        {sent ? (
          <p className="auth-alt"><Link to="/login">Volver a iniciar sesión</Link></p>
        ) : (
          <>
            <form onSubmit={onSubmit} className="auth-form">
              <label>
                Correo electrónico
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="email" />
              </label>
              {error && <div className="form-error">{error}</div>}
              <button className="btn primary lg" disabled={busy}>{busy ? 'Enviando…' : 'Enviar enlace'}</button>
            </form>
            <p className="auth-alt"><Link to="/login">Volver a iniciar sesión</Link></p>
          </>
        )}
    </AuthLayout>
  );
}
