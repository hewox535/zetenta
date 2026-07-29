import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchOrders } from '../lib/api';
import { usd, bs, formatDate } from '../lib/calc';

export default function OrdersHistory() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchOrders().then(setOrders).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Historial de pedidos</h1>
          <p className="page-sub">Todos los pedidos registrados, del más reciente al más antiguo.</p>
        </div>
        <div className="page-actions">
          <Link to="/orders" className="btn primary">+ Nuevo pedido</Link>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      {orders === null ? (
        <div className="empty">Cargando…</div>
      ) : orders.length === 0 ? (
        <div className="empty">Aún no hay pedidos. Registra el primero en <Link to="/orders">Pedidos</Link>.</div>
      ) : (
        <div className="card table-card">
          <table className="list">
            <thead>
              <tr>
                <th>Nº</th><th>Fecha</th><th>Cliente</th>
                <th>Pago</th><th className="num">Total</th><th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.number}</td>
                  <td>{formatDate(o.created_at)}</td>
                  <td>{o.customer_name || <span className="muted">—</span>}</td>
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
      )}
    </div>
  );
}
