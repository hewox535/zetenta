import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  fetchProducts, createProduct, deleteProduct,
  fetchMovements, createMovement,
  fetchTaxonomies, findOrCreateTerm, setProductTerms,
} from '../lib/api';
import { money, formatDate } from '../lib/calc';

const MOVE_LABELS = { in: 'Entrada', out: 'Salida', adjustment: 'Ajuste' };

export default function Inventory() {
  const { business } = useAuth();
  const [products, setProducts] = useState(null);
  const [movements, setMovements] = useState([]);
  const [error, setError] = useState(null);

  // formulario de producto
  const [pName, setPName] = useState('');
  const [pSku, setPSku] = useState('');
  const [pUnit, setPUnit] = useState('und');
  const [pPrice, setPPrice] = useState('');
  const [busy, setBusy] = useState(false);

  // taxonomías del negocio (Marca, Modelo, …)
  const [taxonomies, setTaxonomies] = useState([]);
  const [termValues, setTermValues] = useState({});   // { taxonomyId: 'Toyota' } en el formulario
  const [filters, setFilters] = useState({});         // { taxonomyId: termId } sobre la lista

  // movimiento en curso: { productId, type, quantity, note }
  const [move, setMove] = useState(null);

  useEffect(() => {
    Promise.all([fetchProducts(), fetchMovements(), fetchTaxonomies()])
      .then(([p, m, t]) => { setProducts(p); setMovements(m); setTaxonomies(t); })
      .catch((e) => setError(e.message));
  }, []);

  async function onAddProduct(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await createProduct(business.id, {
        name: pName.trim(), sku: pSku.trim(), unit: pUnit.trim() || 'und', price: Number(pPrice) || 0,
      });
      const termIds = [];
      for (const t of taxonomies) {
        const value = (termValues[t.id] || '').trim();
        if (!value) continue;
        const term = await findOrCreateTerm(t.id, value);
        termIds.push(term.id);
      }
      await setProductTerms(created.id, termIds);
      created.product_terms = termIds.map((term_id) => ({ term_id }));
      setProducts((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      if (termIds.length > 0) fetchTaxonomies().then(setTaxonomies).catch(() => {});
      setPName(''); setPSku(''); setPUnit('und'); setPPrice(''); setTermValues({});
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // nombre de cada término, para etiquetas y filtros
  const termName = new Map();
  taxonomies.forEach((t) => t.taxonomy_terms.forEach((term) => termName.set(term.id, term.name)));

  const visibleProducts = (products || []).filter((p) =>
    Object.entries(filters).every(([, termId]) =>
      !termId || (p.product_terms || []).some((pt) => pt.term_id === termId))
  );
  const filterables = taxonomies.filter((t) => t.taxonomy_terms.length > 0);

  async function onDeleteProduct(p) {
    if (!confirm(`¿Eliminar ${p.name} y su historial de movimientos?`)) return;
    try {
      await deleteProduct(p.id);
      setProducts((prev) => prev.filter((r) => r.id !== p.id));
      setMovements((prev) => prev.filter((m) => m.product_id !== p.id));
    } catch (e) {
      setError(e.message);
    }
  }

  async function onSubmitMove(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createMovement(business.id, {
        productId: move.productId, type: move.type,
        quantity: Number(move.quantity), note: move.note.trim(),
      });
      const [p, m] = await Promise.all([fetchProducts(), fetchMovements()]);
      setProducts(p); setMovements(m);
      setMove(null);
    } catch (err) {
      setError(err.message.includes('Insufficient stock') ? 'No hay stock suficiente para esa salida.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Inventario</h1>
          <p className="page-sub">Productos y movimientos de stock.</p>
        </div>
      </header>

      <div className="card vsection">
        <h2>Nuevo producto</h2>
        <form onSubmit={onAddProduct} className="vform">
          <div className="inline-form">
            <label>
              Nombre
              <input value={pName} onChange={(e) => setPName(e.target.value)} required placeholder="Parabrisas Corolla 2020" />
            </label>
            <label className="short">
              Precio
              <input type="number" step="0.01" min="0" value={pPrice} onChange={(e) => setPPrice(e.target.value)} placeholder="0,00" />
            </label>
            <div className="inline-form-actions">
              <button className="btn primary" disabled={busy}>Agregar</button>
            </div>
          </div>
          <details className="vmore">
            <summary>Configuración avanzada</summary>
            <div className="vgrid">
              <label>
                SKU
                <input value={pSku} onChange={(e) => setPSku(e.target.value)} placeholder="PB-COR-20" />
              </label>
              <label>
                Unidad de medida
                <input value={pUnit} onChange={(e) => setPUnit(e.target.value)} placeholder="und, kg, cajas…" />
              </label>
              {taxonomies.map((t) => (
                <label key={t.id}>
                  {t.name}
                  <input list={`terms-${t.id}`} value={termValues[t.id] || ''}
                    onChange={(e) => setTermValues((v) => ({ ...v, [t.id]: e.target.value }))}
                    placeholder={t.name === 'Marca' ? 'Toyota' : t.name === 'Modelo' ? 'Corolla' : ''} />
                  <datalist id={`terms-${t.id}`}>
                    {t.taxonomy_terms.map((term) => <option key={term.id} value={term.name} />)}
                  </datalist>
                </label>
              ))}
            </div>
            <p className="hint">
              Escribe el valor y se crea solo si no existe. Gestiona las categorías en <a href="/settings">Negocio</a>.
            </p>
          </details>
        </form>
        {error && <div className="form-error">{error}</div>}
      </div>

      {products === null ? (
        <div className="empty">Cargando…</div>
      ) : products.length === 0 ? (
        <div className="empty">Aún no tienes productos. Agrega el primero arriba.</div>
      ) : (
        <>
        {filterables.length > 0 && (
          <div className="filters">
            {filterables.map((t) => (
              <select key={t.id} value={filters[t.id] || ''}
                onChange={(e) => setFilters((f) => ({ ...f, [t.id]: e.target.value }))}>
                <option value="">{t.name}: todas</option>
                {t.taxonomy_terms.map((term) => (
                  <option key={term.id} value={term.id}>{term.name}</option>
                ))}
              </select>
            ))}
          </div>
        )}
        <div className="card table-card">
          <table className="list">
            <thead>
              <tr><th>Producto</th><th>SKU</th><th className="num">Precio</th><th className="num">Stock</th><th /></tr>
            </thead>
            <tbody>
              {visibleProducts.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    {(p.product_terms || []).length > 0 && (
                      <div className="product-tags">
                        {p.product_terms.map((pt) => termName.get(pt.term_id)).filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="mono">{p.sku}</td>
                  <td className="num">{money(p.price)}</td>
                  <td className="num"><strong>{Number(p.stock)}</strong> {p.unit}</td>
                  <td className="row-actions">
                    <button className="btn ghost sm" onClick={() => setMove({ productId: p.id, type: 'in', quantity: '', note: '' })}>+ Entrada</button>
                    <button className="btn ghost sm" onClick={() => setMove({ productId: p.id, type: 'out', quantity: '', note: '' })}>− Salida</button>
                    <button className="btn ghost sm" onClick={() => setMove({ productId: p.id, type: 'adjustment', quantity: String(p.stock), note: '' })}>Ajustar</button>
                    <button className="btn danger sm" onClick={() => onDeleteProduct(p)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {move && (
        <div className="modal-backdrop" onClick={() => setMove(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>
              {MOVE_LABELS[move.type]} — {products.find((p) => p.id === move.productId)?.name}
            </h2>
            <form onSubmit={onSubmitMove} className="vform">
              <label>
                {move.type === 'adjustment' ? 'Stock real contado' : 'Cantidad'}
                <input type="number" step="0.01" min="0" autoFocus required value={move.quantity}
                  onChange={(e) => setMove((m) => ({ ...m, quantity: e.target.value }))} />
              </label>
              <label>
                Nota (opcional)
                <input value={move.note} placeholder={move.type === 'out' ? 'Venta, factura #…' : 'Compra, conteo físico…'}
                  onChange={(e) => setMove((m) => ({ ...m, note: e.target.value }))} />
              </label>
              <div className="inline-form-actions">
                <button className="btn primary" disabled={busy}>Registrar</button>
                <button type="button" className="btn ghost" onClick={() => setMove(null)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {movements.length > 0 && (
        <>
          <h2 className="section-title">Últimos movimientos</h2>
          <div className="card table-card">
            <table className="list">
              <thead>
                <tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th className="num">Cantidad</th><th>Nota</th></tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDate(m.created_at)}</td>
                    <td>{m.products?.name ?? '—'}</td>
                    <td><span className={`badge ${m.type}`}>{MOVE_LABELS[m.type]}</span></td>
                    <td className="num">{Number(m.quantity)}</td>
                    <td className="muted">{m.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
