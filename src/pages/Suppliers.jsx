import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchSuppliers, createSupplier, updateSupplier, deleteSupplier } from '../lib/api';

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
        <div className="card table-card">
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
      )}
    </div>
  );
}
