import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchOrders, fetchStaff, cancelOrder } from '../lib/api';
import { usd, bs, formatDate } from '../lib/calc';

export default function OrdersHistory() {
  const [orders, setOrders] = useState(null);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState(null);
  // Venta que se está cancelando: { order, pin, reason, busy, error }
  const [cancel, setCancel] = useState(null);

  useEffect(() => {
    fetchOrders().then(setOrders).catch((e) => setError(e.message));
    fetchStaff().then(setStaff).catch(() => {});
  }, []);

  async function onCancel(e) {
    e.preventDefault();
    setCancel((c) => ({ ...c, busy: true, error: null }));
    try {
      const updated = await cancelOrder(cancel.order.id, cancel.pin, cancel.reason);
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
      setCancel(null);
    } catch (err) {
      setCancel((c) => ({ ...c, busy: false, error: err.message }));
    }
  }

  const staffName = useMemo(() => {
    const m = new Map();
    staff.forEach((s) => m.set(s.id, s.full_name || s.email));
    return m;
  }, [staff]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Historial de ventas</h1>
          <p className="page-sub">Todas las ventas registradas, de la más reciente a la más antigua.</p>
        </div>
        <div className="page-actions">
          <Link to="/orders" className="btn primary">+ Nueva venta</Link>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      {orders === null ? (
        <div className="empty">Cargando…</div>
      ) : orders.length === 0 ? (
        <div className="empty">Aún no hay ventas. Registra la primera en <Link to="/orders">Ventas</Link>.</div>
      ) : (
        <>
        <div className="card table-card m-hide">
          <table className="list">
            <thead>
              <tr>
                <th>Nº</th><th>Fecha</th><th>Cliente</th><th>Atendió</th>
                <th>Pago</th><th className="num">Total</th><th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className={o.cancelled_at ? 'row-cancelled' : undefined}>
                  <td className="mono">
                    {o.number}
                    {o.cancelled_at && <div><span className="badge out">Cancelada</span></div>}
                  </td>
                  <td>{formatDate(o.created_at)}</td>
                  <td>{o.customer_name || <span className="muted">—</span>}</td>
                  <td className="muted">{staffName.get(o.created_by) || <span className="muted">—</span>}</td>
                  <td className="muted">
                    {(o.order_payments || []).map((p) => p.method_name || p.account_name).filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="num">
                    <div>{usd(o.total_usd)}</div>
                    <div className="muted">{bs(o.total_ves)}</div>
                  </td>
                  <td className="row-actions">
                    <Link to={`/orders/${o.id}`} className="btn ghost sm">Ver</Link>
                    {!o.cancelled_at && (
                      <button type="button" className="btn danger sm"
                        onClick={() => setCancel({ order: o, pin: '', reason: '' })}>Cancelar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* -------- Lista móvil: cada venta es una tarjeta que abre el detalle -------- */}
        <div className="mlist">
          {orders.map((o) => (
            <div className="mcard-wrap" key={o.id}>
            <Link to={`/orders/${o.id}`} className="mcard mcard-link">
              <div className="mcard-info">
                <span className="mcard-title">
                  <span className="mono">#{o.number}</span> · {o.customer_name || 'Sin cliente'}
                  {o.cancelled_at && <span className="badge out">Cancelada</span>}
                </span>
                <span className="muted">
                  {formatDate(o.created_at)}{staffName.get(o.created_by) ? ` · ${staffName.get(o.created_by)}` : ''}
                </span>
                <span className="muted">{(o.order_payments || []).map((p) => p.method_name || p.account_name).filter(Boolean).join(', ') || '—'}</span>
              </div>
              <div className="mcard-amount">
                <strong>{usd(o.total_usd)}</strong>
                <span className="muted">{bs(o.total_ves)}</span>
              </div>
              <span className="mcard-chev" aria-hidden="true">›</span>
            </Link>
            {!o.cancelled_at && (
              <button type="button" className="btn danger sm mcard-cancel"
                onClick={() => setCancel({ order: o, pin: '', reason: '' })}>Cancelar venta</button>
            )}
            </div>
          ))}
        </div>
        </>
      )}

      {cancel && (
        <div className="modal-backdrop" onClick={() => !cancel.busy && setCancel(null)}>
          <div className="modal card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Cancelar la venta Nº {cancel.order.number}</h2>
              <button type="button" className="btn ghost sm" disabled={cancel.busy}
                onClick={() => setCancel(null)}>Cerrar</button>
            </div>
            <p className="hint">
              Los productos vuelven al inventario y la venta queda marcada como cancelada: no se
              borra, para que el historial siga cuadrando. Hace falta el PIN del dueño.
            </p>
            <form onSubmit={onCancel} className="vform">
              <label>PIN del dueño
                <input type="password" inputMode="numeric" autoComplete="off" autoFocus required
                  value={cancel.pin} onChange={(e) => setCancel((c) => ({ ...c, pin: e.target.value }))} />
              </label>
              <label>Motivo (opcional)
                <input value={cancel.reason} placeholder="Se cobró de más, el cliente se arrepintió…"
                  onChange={(e) => setCancel((c) => ({ ...c, reason: e.target.value }))} />
              </label>
              {cancel.error && <div className="form-error">{cancel.error}</div>}
              <div className="inline-form-actions">
                <button className="btn danger-solid" disabled={cancel.busy || !cancel.pin}>
                  {cancel.busy ? 'Cancelando…' : 'Cancelar la venta'}
                </button>
                <button type="button" className="btn ghost" disabled={cancel.busy}
                  onClick={() => setCancel(null)}>Volver</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
