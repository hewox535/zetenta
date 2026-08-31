import { useEffect, useState } from 'react';
import { fetchBusinesses, updateBusinessCapabilities, updateBusinessBranding, uploadBrandingAsset } from '../lib/api';
import { formatDate } from '../lib/calc';

// Dominio donde vive la plataforma: los slugs se sirven como subdominios de él.
const PLATFORM_DOMAIN = 'zetenta.app';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const CAPABILITIES = [
  ['orders', 'Ventas'],
  ['inventory', 'Inventario'],
  ['stats', 'Estadísticas'],
  ['customers', 'Clientes'],
  ['retentions', 'Retenciones'],
];

const CAP_HINTS = {
  orders: 'Punto de venta y historial de pedidos.',
  inventory: 'Productos, variaciones y stock.',
  stats: 'Estadísticas del negocio.',
  customers: 'Base de clientes y campañas.',
  retentions: 'Retenciones y proveedores.',
};

export default function Admin() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // negocio en edición de marca/dominio

  useEffect(() => {
    fetchBusinesses().then(setRows).catch((e) => setError(e.message));
  }, []);

  async function toggle(business, key) {
    const capabilities = { ...business.capabilities, [key]: !business.capabilities?.[key] };
    setRows((prev) => prev.map((b) => (b.id === business.id ? { ...b, capabilities } : b)));
    try {
      const updated = await updateBusinessCapabilities(business.id, capabilities);
      setRows((prev) => prev.map((b) => (b.id === business.id ? updated : b)));
    } catch (e) {
      setError(e.message);
      setRows((prev) => prev.map((b) => (b.id === business.id ? business : b)));
    }
  }

  function onSaved(updated) {
    setRows((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    setEditing(null);
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Administración</h1>
          <p className="page-sub">Negocios de la plataforma, sus módulos y su marca por dominio.</p>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      {rows === null ? (
        <div className="empty">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="empty">Todavía no hay negocios registrados.</div>
      ) : (
        <div className="card table-card">
          <table className="list">
            <thead>
              <tr>
                <th>Negocio</th>
                <th>Dominio</th>
                <th>Registrado</th>
                {CAPABILITIES.map(([key, label]) => <th key={key} className="centro">{label}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong></td>
                  <td className="mono">
                    {b.custom_domain || b.slug || <span className="muted">—</span>}
                  </td>
                  <td>{formatDate(b.created_at)}</td>
                  {CAPABILITIES.map(([key]) => (
                    <td key={key} className="centro">
                      <button
                        className={`switch${b.capabilities?.[key] ? ' on' : ''}`}
                        role="switch"
                        aria-checked={!!b.capabilities?.[key]}
                        onClick={() => toggle(b, key)}
                      >
                        <span className="switch-knob" />
                      </button>
                    </td>
                  ))}
                  <td className="row-actions">
                    <button className="btn ghost sm" onClick={() => setEditing(b)}>Marca</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <BrandingModal business={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  );
}

function BrandingModal({ business, onClose, onSaved }) {
  const [slug, setSlug] = useState(business.slug || '');
  const [customDomain, setCustomDomain] = useState(business.custom_domain || '');
  const [name, setName] = useState(business.branding?.name || '');
  const [accent, setAccent] = useState(business.branding?.accent || '#0071e3');
  const [accent2, setAccent2] = useState(business.branding?.accent2 || business.branding?.accent || '#0077ed');
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
        <input className="color-hex" value={value} onChange={onText} placeholder="#0071e3" maxLength={7} spellCheck={false} />
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
