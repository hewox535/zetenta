import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

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
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">zetenta</div>
        <h1>Recuperar contraseña</h1>
        {sent ? (
          <>
            <p className="auth-sub">
              Si <strong>{email}</strong> está registrado, en unos minutos recibirás un
              correo con un enlace para crear una contraseña nueva. Revisa también la
              carpeta de spam.
            </p>
            <p className="auth-alt"><Link to="/login">Volver a iniciar sesión</Link></p>
          </>
        ) : (
          <>
            <p className="auth-sub">
              Escribe tu correo y te enviaremos un enlace para crear una contraseña nueva.
            </p>
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
      </div>
    </div>
  );
}
