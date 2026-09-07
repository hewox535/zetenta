import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchSuppliers, createSupplier, updateSupplier, deleteSupplier } from '../lib/api';

const ICON = {
  edit: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>,
  trash: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M6 7l1 12a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

export default function Suppliers() {
  const { business } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [rif, setRif] = useState('');
  const [editing, setEditing] = useState(null); // id en edición
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchSuppliers().then(setRows).catch((e) => setError(e.message));
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (editing) {
        const updated = await updateSupplier(editing, { name: name.trim(), rif: rif.trim().toUpperCase() });
        setRows((prev) => prev.map((r) => (r.id === editing ? updated : r)).sort((a, b) => a.name.localeCompare(b.name)));
      } else {
        const created = await createSupplier(business.id, { name: name.trim(), rif: rif.trim().toUpperCase() });
        setRows((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      }
      setName(''); setRif(''); setEditing(null);
    } catch (err) {
      setError(err.message.includes('duplicate') ? 'Ya existe un proveedor con ese RIF.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(s) {
    setEditing(s.id);
    setName(s.name);
    setRif(s.rif);
  }

  async function onDelete(s) {
    if (!confirm(`¿Eliminar a ${s.name}? Sus comprobantes emitidos se conservan.`)) return;
    try {
      await deleteSupplier(s.id);
      setRows((prev) => prev.filter((r) => r.id !== s.id));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Proveedores</h1>
          <p className="page-sub">Sujetos retenidos de tu negocio.</p>
        </div>
      </header>

      <div className="card vsection">
        <h2>{editing ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
        <form onSubmit={onSubmit} className="inline-form">
          <label>
            Razón social
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Super Glass Oriente C.A" />
          </label>
          <label>
            RIF
            <input value={rif} onChange={(e) => setRif(e.target.value)} required placeholder="J-406652059" />
          </label>
          <div className="inline-form-actions">
            <button className="btn primary" disabled={busy}>{editing ? 'Guardar' : 'Agregar'}</button>
            {editing && (
              <button type="button" className="btn ghost" onClick={() => { setEditing(null); setName(''); setRif(''); }}>
                Cancelar
              </button>
            )}
          </div>
        </form>
        {error && <div className="form-error">{error}</div>}
      </div>

      {rows === null ? (
        <div className="empty">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="empty">Aún no tienes proveedores registrados.</div>
      ) : (
        <>
        <div className="card table-card m-hide">
          <table className="list">
            <thead>
              <tr><th>Razón social</th><th>RIF</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="mono">{s.rif}</td>
                  <td className="row-actions">
                    <button className="btn ghost sm" onClick={() => startEdit(s)}>Editar</button>
                    <button className="btn danger sm" onClick={() => onDelete(s)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* -------- Lista móvil -------- */}
        <div className="mlist">
          {rows.map((s) => (
            <div className="mcard" key={s.id}>
              <div className="mcard-info">
                <span className="mcard-title">{s.name}</span>
                <span className="muted mono">{s.rif}</span>
              </div>
              <div className="mcard-actions">
                <button className="icon-btn" title="Editar" aria-label={`Editar ${s.name}`}
                  onClick={() => { startEdit(s); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{ICON.edit}</button>
                <button className="icon-btn danger" title="Eliminar" aria-label={`Eliminar ${s.name}`} onClick={() => onDelete(s)}>{ICON.trash}</button>
              </div>
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
