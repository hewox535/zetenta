import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchOrders, fetchStaff } from '../lib/api';
import { usd, bs, formatDate } from '../lib/calc';

export default function OrdersHistory() {
  const [orders, setOrders] = useState(null);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchOrders().then(setOrders).catch((e) => setError(e.message));
    fetchStaff().then(setStaff).catch(() => {});
  }, []);

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
                <tr key={o.id}>
                  <td className="mono">{o.number}</td>
                  <td>{formatDate(o.created_at)}</td>
                  <td>{o.customer_name || <span className="muted">—</span>}</td>
                  <td className="muted">{staffName.get(o.created_by) || <span className="muted">—</span>}</td>
                  <td className="muted">
                    {(o.order_payments || []).map((p) => p.method_name).join(', ') || '—'}
                  </td>
                  <td className="num">
                    <div>{usd(o.total_usd)}</div>
                    <div className="muted">{bs(o.total_ves)}</div>
                  </td>
                  <td className="row-actions">
                    <Link to={`/orders/${o.id}`} className="btn ghost sm">Ver</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* -------- Lista móvil: cada venta es una tarjeta que abre el detalle -------- */}
        <div className="mlist">
          {orders.map((o) => (
            <Link to={`/orders/${o.id}`} className="mcard mcard-link" key={o.id}>
              <div className="mcard-info">
                <span className="mcard-title">
                  <span className="mono">#{o.number}</span> · {o.customer_name || 'Sin cliente'}
                </span>
                <span className="muted">
                  {formatDate(o.created_at)}{staffName.get(o.created_by) ? ` · ${staffName.get(o.created_by)}` : ''}
                </span>
                <span className="muted">{(o.order_payments || []).map((p) => p.method_name).join(', ') || '—'}</span>
              </div>
              <div className="mcard-amount">
                <strong>{usd(o.total_usd)}</strong>
                <span className="muted">{bs(o.total_ves)}</span>
              </div>
              <span className="mcard-chev" aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
