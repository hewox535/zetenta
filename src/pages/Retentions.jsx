import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchWithholdings, deleteWithholding } from '../lib/api';
import { calcTotals, money, formatDate } from '../lib/calc';
import { useConfirm } from '../components/Confirm';

const ICON = {
  edit: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>,
  trash: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M6 7l1 12a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

export default function Retentions() {
  const ask = useConfirm();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchWithholdings().then(setRows).catch((e) => setError(e.message));
  }, []);

  async function onDelete(w) {
    if (!await ask({ title: `¿Eliminar el comprobante ${w.number}?`, message: 'Esta acción no se puede deshacer.', confirmLabel: 'Eliminar comprobante' })) return;
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
        <>
        <div className="card table-card m-hide">
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
                      <Link className="btn ghost sm" to={`/retentions/${w.id}/edit`}>Editar</Link>
                      <button className="btn danger sm" onClick={() => onDelete(w)}>Eliminar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* -------- Lista móvil: tocar la tarjeta abre el comprobante -------- */}
        <div className="mlist">
          {rows.map((w) => {
            const totals = calcTotals(w.withholding_lines || []);
            return (
              <div className="mcard" key={w.id}>
                <Link to={`/retentions/${w.id}`} className="mcard-info mcard-info-link">
                  <span className="mcard-title mono">{w.number}</span>
                  <span className="muted">{formatDate(w.issue_date)} · {w.supplier_name}</span>
                  <span className="muted">IVA retenido: <strong>{money(totals.totalWithheld)}</strong></span>
                </Link>
                <div className="mcard-actions">
                  <Link className="icon-btn" to={`/retentions/${w.id}/edit`} title="Editar" aria-label={`Editar ${w.number}`}>{ICON.edit}</Link>
                  <button className="icon-btn danger" title="Eliminar" aria-label={`Eliminar ${w.number}`} onClick={() => onDelete(w)}>{ICON.trash}</button>
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}
