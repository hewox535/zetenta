import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchInvoices, fetchFiscalProfile } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useBranchFilter, BranchSelect } from '../components/BranchFilter';
import { bs, usd } from '../lib/calc';
import { norm, downloadCsv } from '../lib/finance';
import { DOC_TITLES, invoiceNo, salesBookRows, bookTotals } from '../lib/fiscal';
import '../components/invoices.css';
import './finance.css';

// Mes actual en Caracas, "yyyy-mm".
const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }).slice(0, 7);
const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
};
const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-VE', { month: 'long', year: 'numeric' });
};
// Los últimos n meses, del actual hacia atrás ("yyyy-mm").
const lastMonths = (n) => {
  const [y, m] = thisMonth().split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
};
const PAGE = 50;
const dateVE = (iso) => new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Caracas' });
const dayTime = (iso) => new Date(iso).toLocaleString('es-VE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Caracas' });

function Mark({ text, q }) {
  const t = String(text ?? '');
  if (!q) return t;
  const i = norm(t).indexOf(q);
  if (i < 0) return t;
  return <>{t.slice(0, i)}<mark>{t.slice(i, i + q.length)}</mark>{t.slice(i + q.length)}</>;
}

function StatusPill({ inv, voided }) {
  if (inv.doc_type !== 'factura') return <span className="inv-status note">{DOC_TITLES[inv.doc_type]}</span>;
  if (voided) return <span className="inv-status void">Anulada</span>;
  if (inv.control_status === 'assigned') return <span className="inv-status ok">Emitida</span>;
  return <span className="inv-status pending" title="El número de control lo asigna la imprenta digital">Control pendiente</span>;
}

export default function Invoices() {
  const { business } = useAuth();
  const navigate = useNavigate();
  const [month, setMonth] = useState(thisMonth);
  const [rows, setRows] = useState(null);
  const [fiscal, setFiscal] = useState(undefined);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [month, query]);
  const bf = useBranchFilter();

  useEffect(() => { fetchFiscalProfile().then(setFiscal).catch(() => setFiscal(null)); }, []);
  useEffect(() => {
    setRows(null); setError(null);
    fetchInvoices(monthRange(month)).then(setRows).catch((e) => setError(e.message));
  }, [month]);

  const inBranch = useMemo(() => (rows || []).filter((i) => bf.match(i.branch_id)), [rows, bf.match]);
  const voidedIds = useMemo(() => new Set(inBranch.filter((i) => i.doc_type === 'nota_credito').map((i) => i.related_invoice_id)), [inBranch]);
  const q = norm(query.trim());
  const shown = useMemo(() => inBranch.filter((i) => !q
    || norm(`${i.customer?.name} ${i.customer?.document} ${invoiceNo(i.number)} ${i.control_number || ''}`).includes(q)), [inBranch, q]);
  const t = bookTotals(inBranch);
  const page = shown.slice(0, limit);
  const pending = inBranch.filter((i) => i.control_status !== 'assigned').length;
  const { from, to } = monthRange(month);

  function exportBook() {
    downloadCsv(`libro-de-ventas-${month}.csv`, salesBookRows(inBranch, { fmtDate: dateVE }));
  }

  // Sin facturación activa y sin documentos: se explica cómo activarla.
  if (fiscal !== undefined && fiscal?.status !== 'active' && rows && rows.length === 0) {
    return (
      <div className="page">
        <header className="page-head"><div><h1>Facturas</h1><p className="page-sub">Facturación digital de {business?.name}.</p></div></header>
        <div className="card inv-empty">
          <h2>La facturación digital aún no está activa</h2>
          <p className="muted">Completa la solicitud en Negocio → Facturación. Cuando esté activa, cada venta puede salir con su factura.</p>
          <Link className="btn primary" to="/settings?seccion=facturacion">Ir a la solicitud</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Facturas</h1>
          <p className="page-sub">Facturas y notas de crédito de {monthLabel(month)} (del {dateVE(`${from}T12:00:00`)} al {dateVE(`${to}T12:00:00`)}).</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn ghost" disabled={!inBranch.length} onClick={exportBook}>Libro de Ventas (CSV)</button>
        </div>
      </header>

      {pending > 0 && (
        <div className="inv-banner" role="note">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 7.5v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <p><b>{pending} {pending === 1 ? 'documento tiene' : 'documentos tienen'} el número de control pendiente.</b> La imprenta digital lo asignará cuando se conecte el servicio; mientras tanto, la numeración y los montos ya quedan registrados.</p>
        </div>
      )}

      <div className="fin-kpis">
        <div className="fin-kpi"><span className="fin-kpi-label">Facturas</span><span className="fin-kpi-value">{t.count}</span><span className="fin-kpi-sub">{t.credit} {t.credit === 1 ? 'nota de crédito' : 'notas de crédito'}</span></div>
        <div className="fin-kpi"><span className="fin-kpi-label">Total facturado</span><span className="fin-kpi-value">{bs(t.total)}</span><span className="fin-kpi-sub">{usd(t.usd)} · neto de notas</span></div>
        <div className="fin-kpi"><span className="fin-kpi-label">Base imponible</span><span className="fin-kpi-value">{bs(t.base)}</span><span className="fin-kpi-sub">Exento {bs(t.exempt)}</span></div>
        <div className="fin-kpi"><span className="fin-kpi-label">IVA débito fiscal</span><span className="fin-kpi-value">{bs(t.iva)}</span><span className="fin-kpi-sub">Para la declaración del mes</span></div>
      </div>

      <div className="card fin-board">
        <div className="inv-toolbar">
          <div className="inv-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar facturas"
              placeholder="Buscar por cliente, cédula/RIF o número…"
              onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }} />
            {query && <button type="button" className="inv-search-clear" aria-label="Borrar búsqueda" onClick={() => setQuery('')}>×</button>}
          </div>
          <select className="inv-month" value={month} aria-label="Mes" onChange={(e) => setMonth(e.target.value)}>
            {lastMonths(18).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <BranchSelect filter={bf} />
        </div>
        {q && rows && <p className="inv-count">{shown.length} {shown.length === 1 ? 'resultado' : 'resultados'} para «{query.trim()}»</p>}

        {error && <div className="form-error">{error}</div>}
        {!rows ? (
          <div className="empty">Cargando…</div>
        ) : shown.length === 0 ? (
          <div className="empty">
            {q ? (
              <>Ninguna factura coincide con «{query.trim()}».<br /><button type="button" className="btn ghost sm" onClick={() => setQuery('')}>Borrar búsqueda</button></>
            ) : `No hay facturas en ${monthLabel(month)}. Las ventas facturadas aparecen aquí.`}
          </div>
        ) : (
          <>
            <table className="inv-table">
              <colgroup><col style={{ width: '17%' }} /><col style={{ width: '14%' }} /><col /><col style={{ width: '17%' }} /><col style={{ width: '18%' }} /></colgroup>
              <thead>
                <tr><th>Documento</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th className="r">Total</th></tr>
              </thead>
              <tbody>
                {page.map((i) => (
                  <tr key={i.id} onClick={() => navigate(`/invoices/${i.id}`)}>
                    <td>
                      <Link to={`/invoices/${i.id}`} onClick={(e) => e.stopPropagation()}><strong>Nº <Mark text={invoiceNo(i.number)} q={q} /></strong></Link>
                      <div className="muted">{i.control_number ? `Control ${i.control_number}` : DOC_TITLES[i.doc_type]}</div>
                    </td>
                    <td>{dayTime(i.issued_at)}</td>
                    <td><Mark text={i.customer?.name} q={q} /><div className="muted"><Mark text={i.customer?.document} q={q} /></div></td>
                    <td><StatusPill inv={i} voided={voidedIds.has(i.id)} /></td>
                    <td className="r"><strong>{i.doc_type === 'nota_credito' ? '−' : ''}{bs(i.total_ves)}</strong><div className="muted">{usd(i.total_usd)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="inv-cards">
              {page.map((i) => (
                <Link key={i.id} to={`/invoices/${i.id}`} className="inv-card">
                  <strong>{DOC_TITLES[i.doc_type]} Nº <Mark text={invoiceNo(i.number)} q={q} /></strong>
                  <strong className="r">{i.doc_type === 'nota_credito' ? '−' : ''}{bs(i.total_ves)}</strong>
                  <span className="muted"><Mark text={i.customer?.name} q={q} /> · <Mark text={i.customer?.document} q={q} /></span>
                  <span className="muted r">{usd(i.total_usd)}</span>
                  <span className="muted">{dayTime(i.issued_at)}</span>
                  <span className="r"><StatusPill inv={i} voided={voidedIds.has(i.id)} /></span>
                </Link>
              ))}
            </div>
            {shown.length > limit && (
              <div className="inv-more">
                <button type="button" className="btn ghost" onClick={() => setLimit((l) => l + PAGE)}>
                  Ver más ({shown.length - limit} {shown.length - limit === 1 ? 'restante' : 'restantes'})
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
