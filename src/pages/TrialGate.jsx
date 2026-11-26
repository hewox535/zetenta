import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';
import BrandPreview from '../components/BrandPreview';
import { requestTrial, setPendingBranding, uploadBrandingAsset } from '../lib/api';
import { BRAND_SWATCHES, HEX_RE, darken } from '../lib/color';
import { formatDate } from '../lib/calc';

const CHECK = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>;

// Pantalla de quien tiene sesión pero cuyo negocio no está activo:
// - pendiente: su negocio ya está configurado; solicita la prueba gratuita y
//   espera a que el equipo de Zetenta la apruebe.
// - desactivado: aviso genérico.
export default function TrialGate() {
  const { account, refreshAccount, signOut, profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const branding = account?.branding || {};
  const accent = HEX_RE.test(branding.accent || '') ? branding.accent : '#2323FF';
  const requested = !!account?.trial_requested_at;
  const owner = account?.is_admin;

  const logout = (
    <p className="auth-alt">
      {profile?.email && <span className="zgate-who">{profile.email} · </span>}
      <button type="button" className="linklike" onClick={() => signOut()}>Cerrar sesión</button>
    </p>
  );

  if (account?.status === 'disabled') {
    return (
      <AuthLayout title="Esta cuenta está desactivada" sub="Si crees que es un error, escríbenos y lo revisamos.">
        {logout}
      </AuthLayout>
    );
  }

  async function onRequest() {
    setBusy(true); setError(null);
    try { await requestTrial(); await refreshAccount(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function onColor(c) {
    if (!owner || c === accent) return;
    setError(null);
    try { await setPendingBranding({ accent: c, accent2: darken(c) }); await refreshAccount(); }
    catch (e) { setError(e.message); }
  }
  async function onLogo(file) {
    if (!file) return;
    setUploading(true); setError(null);
    try {
      const url = await uploadBrandingAsset(account.id, file, 'logo');
      await setPendingBranding({ logoUrl: url });
      await refreshAccount();
    } catch (e) { setError(e.message); } finally { setUploading(false); }
  }

  const url = `${account?.slug}.zetenta.app`;

  if (requested) {
    return (
      <AuthLayout title="¡Solicitud enviada!" sub={`Estamos revisando ${account?.name}. Te avisamos apenas tu prueba gratuita esté activa.`}>
        <div className="zgate-done" aria-hidden="true"><span>{CHECK}</span></div>
        <BrandPreview name={branding.name || account?.name} slug={account?.slug} accent={accent} logoUrl={branding.logo_url} />
        <ul className="zgate-list">
          <li><span>{CHECK}</span><em>Solicitud enviada el {formatDate(account.trial_requested_at)}</em></li>
          <li className="next"><span>2</span><em>Activamos tu cuenta (normalmente el mismo día)</em></li>
          <li className="next"><span>3</span><em>Entras en <b>{url}</b> con tu correo y contraseña</em></li>
        </ul>
        {logout}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Tu negocio está listo" sub="Solo falta activar tu prueba gratuita. Mientras tanto, dale los últimos toques a tu marca.">
      <BrandPreview name={branding.name || account?.name} slug={account?.slug} accent={accent} logoUrl={branding.logo_url} />

      {owner && (
        <div className="zgate-tune">
          <div className="zreg-swatches" role="radiogroup" aria-label="Color de tu marca">
            {BRAND_SWATCHES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={accent.toLowerCase() === c.toLowerCase()} aria-label={c}
                className={`zreg-swatch${accent.toLowerCase() === c.toLowerCase() ? ' on' : ''}`} style={{ '--c': c }}
                onClick={() => onColor(c)} />
            ))}
          </div>
          <label className="btn ghost sm zgate-logo">
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden disabled={uploading}
              onChange={(e) => { onLogo(e.target.files[0]); e.target.value = ''; }} />
            {uploading ? 'Subiendo…' : branding.logo_url ? 'Cambiar logo' : 'Subir logo (opcional)'}
          </label>
        </div>
      )}

      <ul className="zgate-list">
        <li><span>{CHECK}</span><em>Tu dirección: <b>{url}</b></em></li>
        <li><span>{CHECK}</span><em>Tu marca: nombre y color{branding.logo_url ? ', con tu logo' : ''}</em></li>
        <li><span>{CHECK}</span><em>Sucursal principal y cuentas de cobro listas</em></li>
      </ul>

      {error && <div className="form-error">{error}</div>}
      {owner ? (
        <button type="button" className="btn primary lg" disabled={busy} onClick={onRequest}>
          {busy ? 'Enviando…' : 'Solicitar prueba gratuita'}
        </button>
      ) : (
        <p className="zauth-sub">El dueño del negocio debe solicitar la prueba gratuita.</p>
      )}
      {logout}
    </AuthLayout>
  );
}
