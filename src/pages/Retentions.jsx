import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchWithholdings, deleteWithholding } from '../lib/api';
import { calcTotals, money, formatDate } from '../lib/calc';

export default function Retentions() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchWithholdings().then(setRows).catch((e) => setError(e.message));
  }, []);

  async function onDelete(w) {
    if (!confirm(`¿Eliminar el comprobante ${w.number}? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteWithholding(w.id);
      setRows((prev) => prev.filter((r) => r.id !== w.id));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Retenciones</h1>
          <p className="page-sub">Comprobantes de retención de IVA emitidos.</p>
        </div>
        <Link to="/retentions/new" className="btn primary">Nuevo comprobante</Link>
      </header>

      {error && <div className="form-error">{error}</div>}

      {rows === null ? (
        <div className="empty">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <p>Aún no has emitido comprobantes.</p>
          <Link to="/retentions/new" className="btn primary">Emitir el primero</Link>
        </div>
      ) : (
        <div className="card table-card">
          <table className="list">
            <thead>
              <tr>
                <th>Nº de comprobante</th>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th className="num">IVA retenido</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const totals = calcTotals(w.withholding_lines || []);
                return (
                  <tr key={w.id} className="row-link" onClick={() => navigate(`/retentions/${w.id}`)}>
                    <td className="mono">{w.number}</td>
                    <td>{formatDate(w.issue_date)}</td>
                    <td>{w.supplier_name}</td>
                    <td className="num">{money(totals.totalWithheld)}</td>
                    <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <Link className="btn ghost sm" to={`/retentions/${w.id}`}>Ver</Link>
                      <button className="btn danger sm" onClick={() => onDelete(w)}>Eliminar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
