import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';
import AuthLayout from '../components/AuthLayout';
import BrandPreview from '../components/BrandPreview';
import { checkSlug } from '../lib/api';
import { BRAND_SWATCHES, HEX_RE, contrastWithWhite, darken, toSlug } from '../lib/color';

const BUSINESS_TYPES = [
  { value: 'general', label: 'Comercio general', hint: 'Empiezas con Marca y Modelo; las variaciones las configuras luego.' },
  { value: 'ropa', label: 'Ropa y moda', hint: 'Te dejamos listas las tallas (S–XXL) y colores comunes.' },
];

const SLUG_MSG = {
  checking: { tone: 'muted', text: 'Revisando…' },
  ok: { tone: 'ok', text: 'Disponible' },
  taken: { tone: 'bad', text: 'Ya está en uso. Prueba otro.' },
  reserved: { tone: 'bad', text: 'Ese nombre está reservado. Prueba otro.' },
  short: { tone: 'bad', text: 'Mínimo 3 letras o números.' },
};

// Registro en dos pasos. 1: el negocio y su marca (nombre, subdominio, color),
// con la vista previa en vivo. 2: la cuenta del dueño. El negocio queda creado y
// configurado, pendiente de aprobación: después se pide la prueba gratuita.
export default function Register() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('general');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState(null);   // null | 'checking' | 'ok' | 'taken' | 'reserved' | 'short'
  const [accent, setAccent] = useState(BRAND_SWATCHES[0]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(false);
  const seq = useRef(0);

  // El subdominio sigue al nombre hasta que la persona lo edite a mano.
  useEffect(() => { if (!slugTouched) setSlug(toSlug(businessName)); }, [businessName, slugTouched]);

  // Disponibilidad del subdominio (con una pequeña espera para no consultar en cada tecla).
  useEffect(() => {
    if (!slug) { setSlugState(null); return undefined; }
    if (slug.length < 3) { setSlugState('short'); return undefined; }
    setSlugState('checking');
    const my = ++seq.current;
    const t = setTimeout(() => {
      checkSlug(slug).then((r) => { if (my === seq.current) setSlugState(r); })
        .catch(() => { if (my === seq.current) setSlugState(null); });
    }, 350);
    return () => clearTimeout(t);
  }, [slug]);

  const lowContrast = HEX_RE.test(accent) && contrastWithWhite(accent) < 3;
  const step1Ok = businessName.trim().length >= 2 && slugState === 'ok' && HEX_RE.test(accent);

  function next(e) {
    e.preventDefault();
    if (step1Ok) { setError(null); setStep(2); }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { data, error: err } = await signUp(email.trim(), password, {
      businessName: businessName.trim(), fullName: fullName.trim(), businessType,
      slug, accent, accent2: darken(accent),
    });
    setBusy(false);
    if (err) {
      setError(/already registered|already exists/i.test(err.message) ? 'Ya existe una cuenta con ese correo. Inicia sesión.' : err.message);
      return;
    }
    if (!data.session) { setPendingEmail(true); return; } // confirmación de correo activada
    navigate('/', { replace: true });
  }

  if (pendingEmail) {
    return (
      <AuthLayout title="Revisa tu correo" sub="Te enviamos un enlace para confirmar tu cuenta. Al confirmarla, inicia sesión para solicitar tu prueba gratuita.">
        <p className="auth-alt"><Link to="/login">Volver a inicio de sesión</Link></p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={step === 1 ? 'Crea tu negocio' : 'Crea tu cuenta'}
      sub={step === 1 ? 'Tu panel con tu nombre, tu dirección y tus colores.' : `Con esta cuenta administrarás ${businessName.trim() || 'tu negocio'}.`}>
      <ol className="zreg-steps" aria-label="Pasos del registro">
        <li className={step === 1 ? 'on' : 'done'}><span>1</span>Tu negocio</li>
        <li className={step === 2 ? 'on' : ''}><span>2</span>Tu cuenta</li>
      </ol>

      {step === 1 ? (
        <form onSubmit={next} className="auth-form">
          <label>
            Nombre del negocio
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required autoFocus
              placeholder="Mi Negocio, C.A." maxLength={60} />
          </label>

          <label>
            Tu dirección en Zetenta
            <span className={`zreg-slug${slugState ? ` ${SLUG_MSG[slugState]?.tone}` : ''}`}>
              <input value={slug} spellCheck={false} autoCapitalize="none" autoComplete="off" inputMode="url"
                aria-describedby="slug-hint" placeholder="mi-negocio"
                onChange={(e) => { setSlugTouched(true); setSlug(toSlug(e.target.value)); }} />
              <span className="zreg-slug-suffix">.zetenta.app</span>
            </span>
            <span id="slug-hint" className={`field-hint zreg-slug-msg ${slugState ? SLUG_MSG[slugState]?.tone : ''}`} role="status">
              {slugState ? SLUG_MSG[slugState].text : 'Ahí entrarás tú y tu equipo.'}
            </span>
          </label>

          <div className="zreg-field">
            <span className="ztype-title">Color de tu marca</span>
            <div className="zreg-swatches" role="radiogroup" aria-label="Color de tu marca">
              {BRAND_SWATCHES.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={accent.toLowerCase() === c.toLowerCase()}
                  aria-label={c} className={`zreg-swatch${accent.toLowerCase() === c.toLowerCase() ? ' on' : ''}`}
                  style={{ '--c': c }} onClick={() => setAccent(c)} />
              ))}
              <label className={`zreg-swatch zreg-custom${!BRAND_SWATCHES.some((c) => c.toLowerCase() === accent.toLowerCase()) ? ' on' : ''}`}
                title="Otro color" style={{ '--c': accent }}>
                <input type="color" value={HEX_RE.test(accent) ? accent : '#2323ff'} onChange={(e) => setAccent(e.target.value)} aria-label="Otro color" />
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              </label>
            </div>
            {lowContrast && <span className="field-hint zreg-warn">Es un color claro: los botones con texto blanco se leerán poco.</span>}
          </div>

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

          <div className="zreg-preview">
            <span className="ztype-title">Así se verá tu panel</span>
            <BrandPreview name={businessName.trim()} slug={slug} accent={HEX_RE.test(accent) ? accent : undefined} />
            <span className="field-hint">El logo lo subes después; mientras tanto usamos tu inicial.</span>
          </div>

          <button className="btn primary lg" disabled={!step1Ok}>Continuar</button>
        </form>
      ) : (
        <form onSubmit={onSubmit} className="auth-form">
          <button type="button" className="zreg-back" onClick={() => setStep(1)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>
            {businessName.trim()} · {slug}.zetenta.app
          </button>
          <label>
            Tu nombre
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus autoComplete="name" />
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
          <button className="btn primary lg" disabled={busy}>{busy ? 'Creando tu negocio…' : 'Crear cuenta'}</button>
          <p className="field-hint zreg-note">Al crearla, solicitas tu prueba gratuita y la activamos en breve.</p>
        </form>
      )}
      <p className="auth-alt">¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link></p>
    </AuthLayout>
  );
}
