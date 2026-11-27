import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchOrder, fetchStaff, fetchInvoicesForOrder, fetchFiscalProfile, fetchCustomer, issueInvoice, updateCustomer } from '../lib/api';
import { FinModal } from '../components/FinUI';
import { invoiceNo, normDoc } from '../lib/fiscal';
import '../components/invoices.css';
import './finance.css';
import { useAuth } from '../context/AuthContext';
import OrderReceipt from '../components/OrderReceipt';
import { formatDate } from '../lib/calc';

export default function OrderView() {
  const { id } = useParams();
  const { business, capabilities } = useAuth();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [docs, setDocs] = useState([]);            // factura y notas de esta venta
  const [fiscalOn, setFiscalOn] = useState(false);
  const [emit, setEmit] = useState(null);          // { name, document, address, phone, email, customerId, busy, error }

  useEffect(() => {
    fetchInvoicesForOrder(id).then(setDocs).catch(() => {});
    if (capabilities?.invoicing) fetchFiscalProfile().then((f) => setFiscalOn(f?.status === 'active')).catch(() => {});
  }, [id]);

  async function openEmit() {
    const c = order.customer_id ? await fetchCustomer(order.customer_id).catch(() => null) : null;
    setEmit({ name: c?.name || order.customer_name || '', document: c?.document || '', address: c?.address || '',
      phone: c?.phone || '', email: c?.email || '', customerId: c?.id || null, busy: false, error: null });
  }
  async function onEmit(e) {
    e.preventDefault();
    setEmit((s) => ({ ...s, busy: true, error: null }));
    try {
      const doc = normDoc(emit.document);
      const inv = await issueInvoice(order.id, { name: emit.name.trim(), document: doc, address: emit.address.trim(), phone: emit.phone.trim(), email: emit.email.trim() });
      // El cliente queda con los datos fiscales completos para la próxima vez.
      if (emit.customerId) updateCustomer(emit.customerId, { address: emit.address.trim() }).catch(() => {});
      setDocs((d) => [...d, inv]); setEmit(null);
    } catch (err) { setEmit((s) => ({ ...s, busy: false, error: err.message })); }
  }

  useEffect(() => {
    Promise.all([fetchOrder(id), fetchStaff().catch(() => [])])
      .then(([o, staff]) => {
        const who = staff.find((s) => s.id === o.created_by);
        setOrder({ ...o, created_by_name: who ? (who.full_name || who.email) : null });
      })
      .catch((e) => setError(e.message));
  }, [id]);

  // El título es el nombre con el que se guarda el PDF al imprimir.
  useEffect(() => {
    if (!order) return;
    const prev = document.title;
    document.title = `Venta ${order.number}`;
    return () => { document.title = prev; };
  }, [order]);

  if (error) return <div className="page"><div className="form-error">{error}</div></div>;
  if (!order || !business) return <div className="page"><div className="empty">Cargando…</div></div>;

  return (
    <div className="page">
      <header className="page-head no-print">
        <div>
          <h1>Venta {order.number}</h1>
          <p className="page-sub">Detalle de la venta. Imprime o guarda como PDF.</p>
        </div>
        <div className="page-actions">
          <Link to="/orders/history" className="btn ghost">Volver</Link>
          <button className="btn primary" onClick={() => window.print()}>Imprimir</button>
        </div>
      </header>
      {order.cancelled_at && (
        <div className="form-error no-print">
          Venta cancelada el {formatDate(order.cancelled_at)}
          {order.cancel_reason ? ` · ${order.cancel_reason}` : ''}. Los productos volvieron al inventario.
        </div>
      )}
      {(docs.length > 0 || (fiscalOn && !order.cancelled_at)) && (
        <div className="ov-fiscal no-print">
          {docs.map((d) => (
            <Link key={d.id} to={`/invoices/${d.id}`} className="ov-fiscal-doc">
              <strong>{d.doc_type === 'factura' ? 'Factura' : 'Nota de crédito'} Nº {invoiceNo(d.number)}</strong>
              <span className="muted">{d.control_number ? `Control ${d.control_number}` : 'Número de control pendiente'}</span>
            </Link>
          ))}
          {fiscalOn && !order.cancelled_at && !docs.some((d) => d.doc_type === 'factura') && (
            <div className="ov-fiscal-empty">
              <span>Esta venta salió sin factura.</span>
              <button type="button" className="btn sm" onClick={openEmit}>Emitir factura</button>
            </div>
          )}
        </div>
      )}
      <div className="receipt-wrap">
        <OrderReceipt business={business} order={order} />
      </div>
      {emit && (
        <FinModal title={`Factura de la venta ${order.number}`} sub="Con los datos fiscales del cliente. La factura queda numerada y no se puede editar."
          onClose={() => setEmit(null)} busy={emit.busy} onSubmit={onEmit}
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={() => setEmit(null)}>Cancelar</button>
              <button className="btn primary" disabled={emit.busy}>{emit.busy ? 'Emitiendo…' : 'Emitir factura'}</button>
            </>
          )}>
          <label className="fm-field">Nombre o razón social
            <input value={emit.name} onChange={(e) => setEmit((s) => ({ ...s, name: e.target.value }))} required />
          </label>
          <label className="fm-field">Cédula o RIF
            <input value={emit.document} placeholder="V-12345678 o J-123456789" required
              onChange={(e) => setEmit((s) => ({ ...s, document: e.target.value }))}
              onBlur={(e) => setEmit((s) => ({ ...s, document: normDoc(e.target.value) }))} />
          </label>
          <label className="fm-field">Domicilio fiscal{/^[JGC]/i.test(emit.document) ? '' : ' (opcional)'}
            <input value={emit.address} onChange={(e) => setEmit((s) => ({ ...s, address: e.target.value }))} required={/^[JGC]/i.test(emit.document)} />
          </label>
          {emit.error && <div className="form-error">{emit.error}</div>}
        </FinModal>
      )}
    </div>
  );
}
