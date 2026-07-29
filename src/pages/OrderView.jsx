import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchOrder } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import OrderReceipt from '../components/OrderReceipt';

export default function OrderView() {
  const { id } = useParams();
  const { business } = useAuth();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchOrder(id).then(setOrder).catch((e) => setError(e.message));
  }, [id]);

  // El título es el nombre con el que se guarda el PDF al imprimir.
  useEffect(() => {
    if (!order) return;
    const prev = document.title;
    document.title = `Pedido ${order.number}`;
    return () => { document.title = prev; };
  }, [order]);

  if (error) return <div className="page"><div className="form-error">{error}</div></div>;
  if (!order || !business) return <div className="page"><div className="empty">Cargando…</div></div>;

  return (
    <div className="page">
      <header className="page-head no-print">
        <div>
          <h1>Pedido {order.number}</h1>
          <p className="page-sub">Detalle del pedido. Imprime o guarda como PDF.</p>
        </div>
        <div className="page-actions">
          <Link to="/orders/history" className="btn ghost">Volver</Link>
          <button className="btn primary" onClick={() => window.print()}>Imprimir</button>
        </div>
      </header>
      <div className="receipt-wrap">
        <OrderReceipt business={business} order={order} />
      </div>
    </div>
  );
}
