import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchInvoice, fetchInvoicesForOrder, issueCreditNote } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import InvoiceDoc from '../components/InvoiceDoc';
import { FinModal } from '../components/FinUI';
import { DOC_TITLES, invoiceNo } from '../lib/fiscal';
import '../components/invoices.css';
import './finance.css';

export default function InvoiceView() {
  const { id } = useParams();
  const { business, isBusinessAdmin } = useAuth();
  const [inv, setInv] = useState(null);
  const [siblings, setSiblings] = useState([]);    // documentos de la misma venta
  const [error, setError] = useState(null);
  const [nc, setNc] = useState(null);              // { reason, busy, error }

  useEffect(() => {
    let alive = true;
    setInv(null); setError(null);
    fetchInvoice(id).then(async (i) => {
      if (!alive) return;
      setInv(i);
      if (i.order_id) setSiblings(await fetchInvoicesForOrder(i.order_id).catch(() => []));
    }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [id]);

  // El título es el nombre del PDF al imprimir.
  useEffect(() => {
    if (!inv) return;
    const prev = document.title;
    document.title = `${DOC_TITLES[inv.doc_type]} ${invoiceNo(inv.number)}`;
    return () => { document.title = prev; };
  }, [inv]);

  async function onCreditNote(e) {
    e.preventDefault();
    setNc((s) => ({ ...s, busy: true, error: null }));
    try {
      const note = await issueCreditNote(inv.id, nc.reason.trim());
      setSiblings((s) => [...s, note]);
      setNc(null);
    } catch (err) { setNc((s) => ({ ...s, busy: false, error: err.message })); }
  }

  if (error) return <div className="page"><div className="form-error">{error}</div></div>;
  if (!inv) return <div className="page"><div className="empty">Cargando…</div></div>;

  const related = inv.related_invoice_id ? siblings.find((s) => s.id === inv.related_invoice_id) : null;
  const creditNote = inv.doc_type === 'factura' ? siblings.find((s) => s.doc_type === 'nota_credito' && s.related_invoice_id === inv.id) : null;
  const pending = inv.control_status !== 'assigned';

  return (
    <div className="page">
      <header className="page-head no-print">
        <div>
          <h1>{DOC_TITLES[inv.doc_type]} {invoiceNo(inv.number)}</h1>
          <p className="page-sub">
            {inv.customer?.name} · {inv.customer?.document}
            {creditNote && <> · <span className="inv-status void">Anulada</span></>}
          </p>
        </div>
        <div className="page-actions inv-actions">
          <Link to="/invoices" className="btn ghost">Facturas</Link>
          {inv.order_id && <Link to={`/orders/${inv.order_id}`} className="btn ghost">Ver venta</Link>}
          {inv.doc_type === 'factura' && !creditNote && isBusinessAdmin && (
            <button type="button" className="btn ghost" onClick={() => setNc({ reason: '', busy: false, error: null })}>Nota de crédito</button>
          )}
          <button className="btn primary" onClick={() => window.print()}>Imprimir</button>
        </div>
      </header>

      {pending && (
        <div className="inv-banner no-print" role="note">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 7.5v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <p>
            <b>Número de control pendiente.</b> Este documento ya tiene todo lo que exige la norma y su número correlativo.
            Le falta el número de control, que lo asigna la imprenta digital autorizada: se agregará solo cuando se conecte el servicio.
          </p>
        </div>
      )}
      {creditNote && (
        <div className="form-error no-print">
          Anulada con la <Link to={`/invoices/${creditNote.id}`}>nota de crédito Nº {invoiceNo(creditNote.number)}</Link>
          {creditNote.reason ? ` · ${creditNote.reason}` : ''}.
        </div>
      )}

      <InvoiceDoc inv={inv} related={related} logoUrl={business?.branding?.logo_url} />

      {nc && (
        <FinModal title="Emitir nota de crédito"
          sub={`Anula la factura Nº ${invoiceNo(inv.number)} por su total. La nota queda numerada y no se puede borrar.`}
          onClose={() => setNc(null)} busy={nc.busy} onSubmit={onCreditNote}
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={() => setNc(null)}>Cancelar</button>
              <button className="btn primary" disabled={nc.busy || !nc.reason.trim()}>{nc.busy ? 'Emitiendo…' : 'Emitir nota de crédito'}</button>
            </>
          )}>
          <label className="fm-field">
            <span className="fm-label">Motivo</span>
            <input value={nc.reason} onChange={(e) => setNc((s) => ({ ...s, reason: e.target.value }))}
              placeholder="Ej.: devolución de la mercancía, error en los datos del cliente" required />
          </label>
          <p className="hint">Si la venta también se debe anular (devolver el stock y el dinero), anúlala desde el historial de ventas: la nota de crédito sale sola.</p>
          {nc.error && <div className="form-error">{nc.error}</div>}
        </FinModal>
      )}
    </div>
  );
}
