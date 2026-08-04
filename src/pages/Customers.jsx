import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchCustomers, createCustomer, updateCustomer, deleteCustomer } from '../lib/api';

const EMPTY = { name: '', document: '', phone: '', email: '' };

export default function Customers() {
  const { business } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null); // id en edición
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchCustomers().then(setRows).catch((e) => setError(e.message));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const byName = (a, b) => a.name.localeCompare(b.name);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const patch = {
      name: form.name.trim(),
      document: form.document.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
    };
    try {
      if (editing) {
        const updated = await updateCustomer(editing, patch);
        setRows((prev) => prev.map((r) => (r.id === editing ? updated : r)).sort(byName));
      } else {
        const created = await createCustomer(business.id, patch);
        setRows((prev) => [...prev, created].sort(byName));
      }
      setForm(EMPTY); setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(c) {
    setEditing(c.id);
    setForm({ name: c.name, document: c.document || '', phone: c.phone || '', email: c.email || '' });
  }

  function cancel() {
    setEditing(null); setForm(EMPTY);
  }

  async function onDelete(c) {
    if (!confirm(`¿Eliminar a ${c.name}? Sus ventas se conservan.`)) return;
    try {
      await deleteCustomer(c.id);
      setRows((prev) => prev.filter((r) => r.id !== c.id));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Clientes</h1>
          <p className="page-sub">Directorio de clientes de tu negocio.</p>
        </div>
      </header>

      <div className="card vsection">
        <h2>{editing ? 'Editar cliente' : 'Nuevo cliente'}</h2>
        <form onSubmit={onSubmit} className="inline-form">
          <label>
            Nombre
            <input value={form.name} onChange={set('name')} required placeholder="Ana Pérez" />
          </label>
          <label>
            Documento (opcional)
            <input value={form.document} onChange={set('document')} placeholder="V-12345678" />
          </label>
          <label>
            Teléfono (opcional)
            <input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="0412-1234567" />
          </label>
          <label>
            Correo (opcional)
            <input value={form.email} onChange={set('email')} type="email" placeholder="ana@correo.com" />
          </label>
          <div className="inline-form-actions">
            <button className="btn primary" disabled={busy}>{editing ? 'Guardar' : 'Agregar'}</button>
            {editing && <button type="button" className="btn ghost" onClick={cancel}>Cancelar</button>}
          </div>
        </form>
        {error && <div className="form-error">{error}</div>}
      </div>

      {rows === null ? (
        <div className="empty">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="empty">Aún no tienes clientes registrados.</div>
      ) : (
        <div className="card table-card">
          <table className="list">
            <thead>
              <tr><th>Nombre</th><th>Documento</th><th>Teléfono</th><th>Correo</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="mono">{c.document || <span className="muted">—</span>}</td>
                  <td>{c.phone || <span className="muted">—</span>}</td>
                  <td>{c.email || <span className="muted">—</span>}</td>
                  <td className="row-actions">
                    <button className="btn ghost sm" onClick={() => startEdit(c)}>Editar</button>
                    <button className="btn danger sm" onClick={() => onDelete(c)}>Eliminar</button>
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
