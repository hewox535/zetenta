import { useEffect, useState } from 'react';
import { fetchBusinesses, updateBusinessBranding, uploadBrandingAsset, setBusinessStatus } from '../lib/api';
import { formatDate } from '../lib/calc';
import { useConfirm } from '../components/Confirm';
import './finance.css';

// Estados de un negocio y cómo se muestran.
const STATUS = {
  pending: { tab: 'Solicitudes', pill: 'Pendiente', tone: 'soon' },
  active: { tab: 'Activos', pill: 'Activo', tone: 'ok' },
  disabled: { tab: 'Desactivados', pill: 'Desactivado', tone: 'off' },
};

// Dominio donde vive la plataforma: los slugs se sirven como subdominios de él.
const PLATFORM_DOMAIN = 'zetenta.app';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const CAPABILITIES = [
  ['orders', 'Ventas'],
  ['cash', 'Caja'],
  ['inventory', 'Inventario'],
  ['accounts', 'Cuentas por cobrar/pagar'],
  ['expenses', 'Gastos'],
  ['stats', 'Estadísticas'],
  ['customers', 'Clientes'],
  ['campaigns', 'Campañas'],
  ['retentions', 'Retenciones'],
];

const CAP_HINTS = {
  orders: 'Punto de venta y historial de pedidos.',
  cash: 'Apertura y cierre de caja desde el menú lateral.',
  accounts: 'Lo que le deben al negocio y lo que debe, con cobros y pagos.',
  expenses: 'Gastos variables y fijos, por categoría, frente a las ventas.',
  inventory: 'Productos, variaciones y stock.',
  stats: 'Estadísticas del negocio.',
  customers: 'Base de clientes.',
  campaigns: 'Campañas dirigidas desde el módulo de clientes.',
  retentions: 'Retenciones y proveedores.',
};

export default function Admin() {
  const ask = useConfirm();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // negocio en edición de marca/dominio
  const [tab, setTab] = useState(null);         // 'pending' | 'active' | 'disabled'
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    fetchBusinesses().then((list) => {
      setRows(list);
      // Si hay solicitudes, se abre ahí; si no, en los activos.
      setTab((t) => t || (list.some((b) => b.status === 'pending') ? 'pending' : 'active'));
    }).catch((e) => setError(e.message));
  }, []);

  function onSaved(updated) {
    setRows((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    setEditing(null);
  }

  async function changeStatus(b, status) {
    if (status === 'disabled' && !await ask({
      title: `¿Desactivar ${b.name}?`,
      message: 'Sus usuarios no podrán iniciar sesión, se cierran las sesiones abiertas y su dirección mostrará «página no encontrada». Puedes reactivarlo cuando quieras.',
      confirmLabel: 'Desactivar',
    })) return;
    setBusyId(b.id); setError(null);
    try {
      const updated = await setBusinessStatus(b.id, status);
      setRows((prev) => prev.map((x) => (x.id === b.id ? { ...x, ...updated } : x)));
    } catch (e) { setError(e.message); } finally { setBusyId(null); }
  }

  const count = (st) => (rows || []).filter((b) => (b.status || 'active') === st).length;
  const list = (rows || []).filter((b) => (b.status || 'active') === tab)
    .sort((a, b) => (tab === 'pending'
      ? (b.trial_requested_at ? 1 : 0) - (a.trial_requested_at ? 1 : 0) || (b.trial_requested_at || b.created_at).localeCompare(a.trial_requested_at || a.created_at)
      : a.name.localeCompare(b.name)));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Administración</h1>
          <p className="page-sub">Negocios de la plataforma: solicitudes de prueba, módulos y marca por dominio.</p>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      {rows === null ? (
        <div className="empty">Cargando…</div>
      ) : (
        <>
          <div className="fin-tabs-row">
            <div className="fin-tabs" role="tablist">
              {['pending', 'active', 'disabled'].map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k}
                  className={`fin-tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
                  {STATUS[k].tab}
                  {count(k) > 0 && <span className={`fin-tab-count${k === 'pending' ? ' alert' : ''}`}>{count(k)}</span>}
                </button>
              ))}
            </div>
          </div>

          {list.length === 0 ? (
            <div className="card"><div className="empty">
              {tab === 'pending' ? 'No hay solicitudes de prueba por revisar.' : tab === 'disabled' ? 'No hay negocios desactivados.' : 'Todavía no hay negocios activos.'}
            </div></div>
          ) : (
            <div className="card adm-list">
              {list.map((b) => {
                const st = STATUS[b.status || 'active'];
                const accent = b.branding?.accent || '#2323FF';
                return (
                  <div className="adm-row" key={b.id}>
                    <span className="adm-mark" style={{ background: accent }} aria-hidden="true">
                      {b.branding?.logo_url ? <img src={b.branding.logo_url} alt="" /> : (b.name || '?').charAt(0).toUpperCase()}
                    </span>
                    <div className="adm-main">
                      <div className="adm-title">
                        <strong>{b.name}</strong>
                        <span className={`adm-pill ${st.tone}`}>{st.pill}</span>
                      </div>
                      <span className="adm-meta">
                        <span className="mono">{b.custom_domain || (b.slug ? `${b.slug}.zetenta.app` : 'sin dominio')}</span>
                        {' · '}
                        {b.status === 'pending'
                          ? (b.trial_requested_at ? `pidió la prueba el ${formatDate(b.trial_requested_at)}` : `se registró el ${formatDate(b.created_at)}, aún no pide la prueba`)
                          : b.status === 'disabled'
                            ? `desactivado${b.disabled_at ? ` el ${formatDate(b.disabled_at)}` : ''}`
                            : `${CAPABILITIES.filter(([key]) => b.capabilities?.[key]).length} de ${CAPABILITIES.length} módulos · desde ${formatDate(b.approved_at || b.created_at)}`}
                      </span>
                    </div>
                    <div className="adm-actions">
                      {b.status === 'pending' && (
                        <button className="btn primary sm" disabled={busyId === b.id} onClick={() => changeStatus(b, 'active')}>
                          {busyId === b.id ? 'Aprobando…' : 'Aprobar'}
                        </button>
                      )}
                      {b.status === 'disabled' && (
                        <button className="btn sm" disabled={busyId === b.id} onClick={() => changeStatus(b, 'active')}>Reactivar</button>
                      )}
                      <button className="btn ghost sm" onClick={() => setEditing(b)}>Editar</button>
                      {b.status !== 'disabled' && (
                        <button className="btn ghost sm adm-danger" disabled={busyId === b.id} onClick={() => changeStatus(b, 'disabled')}>Desactivar</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {editing && <BrandingModal business={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  );
}

function BrandingModal({ business, onClose, onSaved }) {
  const [slug, setSlug] = useState(business.slug || '');
  const [customDomain, setCustomDomain] = useState(business.custom_domain || '');
  const [name, setName] = useState(business.branding?.name || '');
  const [accent, setAccent] = useState(business.branding?.accent || '#2323FF');
  const [accent2, setAccent2] = useState(business.branding?.accent2 || business.branding?.accent || '#1515e6');
  const [logoUrl, setLogoUrl] = useState(business.branding?.logo_url || '');
  const [faviconUrl, setFaviconUrl] = useState(business.branding?.favicon_url || '');
  const [caps, setCaps] = useState({ ...business.capabilities });
  const [tab, setTab] = useState('brand'); // 'brand' | 'modules'
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(null); // 'logo' | 'favicon'
  const [error, setError] = useState(null);

  async function onPickFile(kind, e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null); setUploading(kind);
    try {
      const url = await uploadBrandingAsset(business.id, file, kind);
      if (kind === 'logo') setLogoUrl(url); else setFaviconUrl(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(null);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const branding = {};
      if (name.trim()) branding.name = name.trim();
      if (HEX_RE.test(accent.trim())) branding.accent = accent.trim();
      if (HEX_RE.test(accent2.trim())) branding.accent2 = accent2.trim();
      if (logoUrl.trim()) branding.logo_url = logoUrl.trim();
      if (faviconUrl.trim()) branding.favicon_url = faviconUrl.trim();
      const updated = await updateBusinessBranding(business.id, { slug, customDomain, branding, capabilities: caps });
      onSaved(updated);
    } catch (err) {
      setError(err.message.includes('duplicate') ? 'Ese slug o dominio ya está en uso por otro negocio.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <h2>{business.name}</h2>
        <nav className="settings-nav modal-tabs">
          <button type="button" className={`settings-tab${tab === 'brand' ? ' active' : ''}`} onClick={() => setTab('brand')}>Marca</button>
          <button type="button" className={`settings-tab${tab === 'modules' ? ' active' : ''}`} onClick={() => setTab('modules')}>Módulos</button>
        </nav>
        <form onSubmit={onSubmit} className="vform">
          {tab === 'brand' && (<>
          <label>
            Subdominio (slug)
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="mi-negocio" />
            <span className="hint">Se accede en <strong>{slug ? slug.trim().toLowerCase() : 'slug'}</strong>.{PLATFORM_DOMAIN}</span>
          </label>
          <label>
            Dominio propio (opcional)
            <input value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} placeholder="tienda.midominio.com" />
          </label>
          <label>
            Nombre de marca
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre visible del negocio" />
          </label>
          <div className="vgrid">
            <ColorField label="Color de acento" hint="Botones, enlaces y detalles." value={accent} onChange={setAccent} />
            <ColorField label="Color secundario" hint="Estados al pasar el cursor." value={accent2} onChange={setAccent2} />
          </div>
          <div className="vgrid">
            <AssetField
              label="Logo"
              hint="PNG o SVG, idealmente con fondo transparente."
              url={logoUrl}
              uploading={uploading === 'logo'}
              onPick={(e) => onPickFile('logo', e)}
              onClear={() => setLogoUrl('')}
            />
            <AssetField
              label="Favicon / ícono de app"
              hint="Cuadrado, mínimo 512×512. Se usa en el tab y en la pantalla de inicio."
              url={faviconUrl}
              uploading={uploading === 'favicon'}
              onPick={(e) => onPickFile('favicon', e)}
              onClear={() => setFaviconUrl('')}
            />
          </div>
          </>)}
          {tab === 'modules' && (
            <div className="module-list">
              {CAPABILITIES.map(([key, label]) => (
                <div className="method-row" key={key}>
                  <div className="module-info">
                    <span className="method-name">{label}</span>
                    <span className="muted">{CAP_HINTS[key]}</span>
                  </div>
                  <button type="button"
                    className={`switch${caps[key] ? ' on' : ''}`}
                    role="switch" aria-checked={!!caps[key]}
                    onClick={() => setCaps((c) => ({ ...c, [key]: !c[key] }))}>
                    <span className="switch-knob" />
                  </button>
                </div>
              ))}
              <span className="hint">Los módulos apagados no aparecen en el menú de ese negocio.</span>
            </div>
          )}
          {error && <div className="form-error">{error}</div>}
          <div className="inline-form-actions">
            <button className="btn primary" disabled={busy || uploading !== null}>{busy ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Selector de color con campo hexadecimal editable: el swatch y el texto se
// sincronizan; solo un hex completo (#rrggbb) se propaga al valor guardado.
function ColorField({ label, hint, value, onChange }) {
  const valid = HEX_RE.test(value);
  function onText(e) {
    let v = e.target.value.trim();
    if (v && !v.startsWith('#')) v = `#${v}`;
    onChange(v);
  }
  return (
    <div className="asset-field">
      <span className="asset-label">{label}</span>
      <div className="color-row">
        <input type="color" value={valid ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
        <input className="color-hex" value={value} onChange={onText} placeholder="#2323FF" maxLength={7} spellCheck={false} />
      </div>
      <span className="hint">{hint}</span>
    </div>
  );
}

// Campo de imagen de marca: vista previa + subir a Supabase Storage + quitar.
function AssetField({ label, hint, url, uploading, onPick, onClear }) {
  return (
    <div className="asset-field">
      <span className="asset-label">{label}</span>
      <div className="asset-row">
        <span className="asset-preview">
          {url ? <img src={url} alt={label} /> : <span className="asset-empty">—</span>}
        </span>
        <label className={`btn ghost sm${uploading ? ' disabled' : ''}`}>
          {uploading ? 'Subiendo…' : (url ? 'Cambiar' : 'Subir')}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            hidden
            disabled={uploading}
            onChange={onPick}
          />
        </label>
        {url && !uploading && <button type="button" className="btn ghost sm" onClick={onClear}>Quitar</button>}
      </div>
      <span className="hint">{hint}</span>
    </div>
  );
}
