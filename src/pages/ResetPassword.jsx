import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';

// Se llega aquí desde el enlace del correo de recuperación. Supabase procesa
// el token de la URL y crea una sesión temporal; con ella se puede fijar la
// contraseña nueva.
export default function ResetPassword() {
  const { loading, session } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    navigate('/', { replace: true });
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">zetenta</div>
        <h1>Nueva contraseña</h1>
        {loading ? (
          <p className="auth-sub">Verificando el enlace…</p>
        ) : !session ? (
          <>
            <p className="auth-sub">
              El enlace no es válido o ya expiró (dura 1 hora y solo se puede usar una vez).
            </p>
            <p className="auth-alt"><Link to="/forgot-password">Pedir un enlace nuevo</Link></p>
          </>
        ) : (
          <>
            <p className="auth-sub">Crea una contraseña nueva para tu cuenta.</p>
            <form onSubmit={onSubmit} className="auth-form">
              <label>
                Contraseña nueva
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  required autoFocus minLength={8} autoComplete="new-password" />
              </label>
              <label>
                Repite la contraseña
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  required minLength={8} autoComplete="new-password" />
              </label>
              {error && <div className="form-error">{error}</div>}
              <button className="btn primary lg" disabled={busy}>{busy ? 'Guardando…' : 'Guardar y entrar'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
