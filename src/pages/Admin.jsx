import { useEffect, useState } from 'react';
import { fetchBusinesses, updateBusinessCapabilities } from '../lib/api';
import { formatDate } from '../lib/calc';

const CAPABILITIES = [
  ['retentions', 'Retenciones'],
  ['inventory', 'Inventario'],
];

export default function Admin() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchBusinesses().then(setRows).catch((e) => setError(e.message));
  }, []);

  async function toggle(business, key) {
    const capabilities = { ...business.capabilities, [key]: !business.capabilities?.[key] };
    // Optimista: refleja el cambio de una vez y revierte si falla
    setRows((prev) => prev.map((b) => (b.id === business.id ? { ...b, capabilities } : b)));
    try {
      const updated = await updateBusinessCapabilities(business.id, capabilities);
      setRows((prev) => prev.map((b) => (b.id === business.id ? updated : b)));
    } catch (e) {
      setError(e.message);
      setRows((prev) => prev.map((b) => (b.id === business.id ? business : b)));
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Administración</h1>
          <p className="page-sub">Negocios de la plataforma y sus módulos habilitados.</p>
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
                <th>RIF</th>
                <th>Registrado</th>
                {CAPABILITIES.map(([key, label]) => <th key={key} className="centro">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong></td>
                  <td className="mono">{b.rif || '—'}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
