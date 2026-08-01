import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMovements, fetchProducts, fetchStaff } from '../lib/api';
import { formatDate, variantLabel } from '../lib/calc';

const MOVE_LABELS = { in: 'Entrada', out: 'Salida', adjustment: 'Ajuste' };

export default function InventoryHistory() {
  const [movements, setMovements] = useState(null);
  const [products, setProducts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState(null);

  const [productId, setProductId] = useState('');
  const [type, setType] = useState('');

  useEffect(() => {
    fetchProducts().then(setProducts).catch(() => {});
    fetchStaff().then(setStaff).catch(() => {});
  }, []);

  useEffect(() => {
    setMovements(null);
    fetchMovements(500, { productId: productId || undefined, type: type || undefined })
      .then(setMovements).catch((e) => setError(e.message));
  }, [productId, type]);

  const staffName = useMemo(() => {
    const m = new Map();
    staff.forEach((s) => m.set(s.id, s.full_name || s.email));
    return m;
  }, [staff]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Historial de inventario</h1>
          <p className="page-sub">Entradas, salidas y ajustes con fecha, usuario y cantidad.</p>
        </div>
        <div className="page-actions">
          <Link to="/inventory" className="btn ghost">Volver a Inventario</Link>
        </div>
      </header>

      <div className="filters">
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Todos los productos</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Todos los tipos</option>
          <option value="in">Entradas</option>
          <option value="out">Salidas</option>
          <option value="adjustment">Ajustes</option>
        </select>
      </div>

      {error && <div className="form-error">{error}</div>}

      {movements === null ? (
        <div className="empty">Cargando…</div>
      ) : movements.length === 0 ? (
        <div className="empty">Sin movimientos para ese filtro.</div>
      ) : (
        <div className="card table-card">
          <table className="list">
            <thead>
              <tr>
                <th>Fecha</th><th>Producto</th><th>Usuario</th>
                <th>Tipo</th><th className="num">Cantidad</th><th>Nota</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const vlabel = variantLabel(m.product_variants?.attributes);
                return (
                  <tr key={m.id}>
                    <td>{formatDate(m.created_at)}</td>
                    <td>{m.products?.name ?? '—'}{vlabel && <span className="muted"> · {vlabel}</span>}</td>
                    <td className="muted">{staffName.get(m.created_by) || <span className="muted">—</span>}</td>
                    <td><span className={`badge ${m.type}`}>{MOVE_LABELS[m.type]}</span></td>
                    <td className="num">{Number(m.quantity)}</td>
                    <td className="muted">{m.note}</td>
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
