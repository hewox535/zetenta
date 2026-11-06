import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchWithholdings, deleteWithholding } from '../lib/api';
import { calcTotals, money, formatDate } from '../lib/calc';
import { useConfirm } from '../components/Confirm';

const ICON = {
  edit: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>,
  trash: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M6 7l1 12a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

// Texto comparable: minúsculas y sin acentos.
const norm = (v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Solo letras y números: "J-12.345.678-9" y "j123456789" coinciden.
const compact = (v) => norm(v).replace(/[^a-z0-9]/g, '');

// Todo lo buscable de un comprobante: número, proveedor, RIF, período,
// fecha (como 25/03/2026 y 2026-03-25) y, de cada factura, su número,
// nº de control, notas de débito/crédito y documento afectado.
function haystack(w) {
  const lines = w.withholding_lines || [];
  const parts = [
    w.number, w.supplier_name, w.supplier_rif, w.fiscal_period,
    w.issue_date, formatDate(w.issue_date),
    ...lines.flatMap((l) => [l.invoice_number, l.control_number, l.debit_note, l.credit_note,
      l.affected_document, l.operation_date, formatDate(l.operation_date)]),
  ].filter(Boolean);
  const text = norm(parts.join(' '));
  return { text, compact: parts.map(compact).join('|') };
}

// Facturas del comprobante que coinciden con la búsqueda (para mostrarlas en la fila).
function matchingInvoices(w, tokens) {
  if (!tokens.length) return [];
  return (w.withholding_lines || [])
    .filter((l) => {
      const fields = [l.invoice_number, l.control_number, l.debit_note, l.credit_note, l.affected_document];
      return tokens.some((t) => fields.some((f) => f && (norm(f).includes(t.text) || (t.compact && compact(f).includes(t.compact)))));
    })
    .map((l) => l.invoice_number || l.control_number || l.debit_note || l.credit_note)
    .filter(Boolean);
}

export default function Retentions() {
  const ask = useConfirm();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    fetchWithholdings().then(setRows).catch((e) => setError(e.message));
  }, []);

  const index = useMemo(() => new Map((rows || []).map((w) => [w.id, haystack(w)])), [rows]);

  // Cada palabra de la búsqueda tiene que aparecer en el comprobante.
  const tokens = useMemo(() => norm(search).split(/\s+/).filter(Boolean)
    .map((t) => ({ text: t, compact: compact(t) })), [search]);

  const filtered = useMemo(() => (rows || []).filter((w) => {
    if (from && w.issue_date < from) return false;
    if (to && w.issue_date > to) return false;
    if (!tokens.length) return true;
    const h = index.get(w.id);
    return tokens.every((t) => h.text.includes(t.text) || (t.compact && h.compact.includes(t.compact)));
  }), [rows, index, tokens, from, to]);

  const filtering = tokens.length > 0 || from || to;
  const clear = () => { setSearch(''); setFrom(''); setTo(''); };

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
        <div className="ret-toolbar">
          <input className="ret-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por proveedor, RIF, nº de comprobante, factura, control o fecha…"
            aria-label="Buscar retenciones" />
          <label className="ret-date">
            <span>Desde</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="ret-date">
            <span>Hasta</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          {filtering && <button type="button" className="btn ghost sm" onClick={clear}>Limpiar</button>}
        </div>
        {filtering && (
          <p className="muted ret-count">
            {filtered.length === 1 ? '1 comprobante' : `${filtered.length} comprobantes`} de {rows.length}
          </p>
        )}

        {filtered.length === 0 ? (
          <div className="empty">
            <p>Ningún comprobante coincide con la búsqueda.</p>
            <button type="button" className="btn ghost" onClick={clear}>Limpiar filtros</button>
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
              {filtered.map((w) => {
                const totals = calcTotals(w.withholding_lines || []);
                const hits = matchingInvoices(w, tokens);
                return (
                  <tr key={w.id} className="row-link" onClick={() => navigate(`/retentions/${w.id}`)}>
                    <td className="mono">{w.number}</td>
                    <td>{formatDate(w.issue_date)}</td>
                    <td>
                      {w.supplier_name}
                      {hits.length > 0 && <div className="ret-hit">Factura {hits.join(', ')}</div>}
                    </td>
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
          {filtered.map((w) => {
            const totals = calcTotals(w.withholding_lines || []);
            const hits = matchingInvoices(w, tokens);
            return (
              <div className="mcard" key={w.id}>
                <Link to={`/retentions/${w.id}`} className="mcard-info mcard-info-link">
                  <span className="mcard-title mono">{w.number}</span>
                  <span className="muted">{formatDate(w.issue_date)} · {w.supplier_name}</span>
                  <span className="muted">IVA retenido: <strong>{money(totals.totalWithheld)}</strong></span>
                  {hits.length > 0 && <span className="ret-hit">Factura {hits.join(', ')}</span>}
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
        </>
      )}
    </div>
  );
}
