import { useEffect, useState } from 'react';
import { fetchBusinesses, updateBusinessCapabilities, updateBusinessBranding } from '../lib/api';
import { formatDate } from '../lib/calc';

const CAPABILITIES = [
  ['orders', 'Pedidos'],
  ['inventory', 'Inventario'],
  ['stats', 'Estadísticas'],
  ['customers', 'Clientes'],
  ['retentions', 'Retenciones'],
];

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
  const [logoUrl, setLogoUrl] = useState(business.branding?.logo_url || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const branding = {};
      if (name.trim()) branding.name = name.trim();
      if (accent.trim()) branding.accent = accent.trim();
      if (logoUrl.trim()) branding.logo_url = logoUrl.trim();
      const updated = await updateBusinessBranding(business.id, { slug, customDomain, branding });
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
        <h2>Marca y dominio — {business.name}</h2>
        <form onSubmit={onSubmit} className="vform">
          <label>
            Subdominio (slug)
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="robert-clothes" />
            <span className="hint">Se accede en <strong>{slug ? slug.trim().toLowerCase() : 'slug'}</strong>.tudominio.com</span>
          </label>
          <label>
            Dominio propio (opcional)
            <input value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} placeholder="tienda.robertclothes.com" />
          </label>
          <label>
            Nombre de marca
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Robert Clothes" />
          </label>
          <div className="vgrid">
            <label>
              Color de acento
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
            </label>
            <label>
              Logo (URL, opcional)
              <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="inline-form-actions">
            <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
