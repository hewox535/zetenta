import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  fetchProducts, fetchTaxonomies, fetchPaymentMethods, createOrder, fetchOrder,
} from '../lib/api';
import { fetchBcvRates, resolveRate } from '../lib/rates';
import { usd, bs, money } from '../lib/calc';
import OrderReceipt from '../components/OrderReceipt';

export default function Orders() {
  const { business } = useAuth();
  const [products, setProducts] = useState(null);
  const [taxonomies, setTaxonomies] = useState([]);
  const [methods, setMethods] = useState([]);
  const [rates, setRates] = useState(null);
  const [rateError, setRateError] = useState(null);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});          // { taxonomyId: termId }

  const [cart, setCart] = useState([]);                // [{ id, name, price, unit, stock, qty }]
  const [stage, setStage] = useState('shop');          // 'shop' | 'pay' | 'done'
  const [panelOpen, setPanelOpen] = useState(false);   // hoja inferior en móvil

  const [customerName, setCustomerName] = useState('');
  const [payments, setPayments] = useState({});        // { methodId: 'monto' }
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(null);      // pedido guardado (con ítems/pagos)

  useEffect(() => {
    Promise.all([fetchProducts(), fetchTaxonomies(), fetchPaymentMethods()])
      .then(([p, t, m]) => { setProducts(p); setTaxonomies(t); setMethods(m.filter((x) => x.active)); })
      .catch((e) => setError(e.message));
    fetchBcvRates().then(setRates).catch((e) => setRateError(e.message));
  }, []);

  const rate = useMemo(() => resolveRate(business?.rate_config, rates), [business, rates]);

  // ------- carrito -------
  const addToCart = (p) => {
    setCart((prev) => {
      const found = prev.find((c) => c.id === p.id);
      if (found) return prev.map((c) => (c.id === p.id ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, { id: p.id, name: p.name, price: Number(p.price), unit: p.unit, stock: Number(p.stock), qty: 1 }];
    });
  };
  const setQty = (id, qty) => {
    if (qty <= 0) return setCart((prev) => prev.filter((c) => c.id !== id));
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, qty } : c)));
  };
  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  const totalUsd = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const totalVes = totalUsd * rate.value;

  // ------- pagos -------
  const paidUsd = methods.reduce((s, m) => {
    const amt = Number(payments[m.id]) || 0;
    return s + (m.currency === 'USD' ? amt : (rate.value ? amt / rate.value : 0));
  }, 0);
  const remainingUsd = Math.max(0, totalUsd - paidUsd);
  const changeUsd = Math.max(0, paidUsd - totalUsd);

  const fillExact = (m) => {
    // Completa el restante con este método (convertido a su moneda)
    const remaining = totalUsd - (paidUsd - (Number(payments[m.id]) || 0));
    if (remaining <= 0) return;
    const amount = m.currency === 'USD' ? remaining : remaining * rate.value;
    setPayments((prev) => ({ ...prev, [m.id]: amount.toFixed(2) }));
  };

  // ------- categorías / filtros -------
  const termName = new Map();
  taxonomies.forEach((t) => t.taxonomy_terms.forEach((term) => termName.set(term.id, term.name)));
  const filterables = taxonomies.filter((t) => t.taxonomy_terms.length > 0);

  const visible = (products || []).filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())
      && !(p.sku || '').toLowerCase().includes(search.toLowerCase())) return false;
    return Object.entries(filters).every(([, termId]) =>
      !termId || (p.product_terms || []).some((pt) => pt.term_id === termId));
  });

  async function onFinish() {
    setError(null);
    if (!rate.value) { setError('No hay tasa de cambio disponible. Configúrala en Negocio → Pedidos.'); return; }
    setBusy(true);
    try {
      const items = cart.map((c) => ({ product_id: c.id, quantity: c.qty }));
      const pays = methods
        .map((m) => ({ methodId: m.id, m, amount: Number(payments[m.id]) || 0 }))
        .filter((x) => x.amount > 0)
        .map((x) => ({ method_id: x.methodId, method_name: x.m.name, currency: x.m.currency, amount: x.amount }));
      const created = await createOrder({
        items, payments: pays, rate: rate.value, rateSource: rate.source, customerName,
      });
      const full = await fetchOrder(created.id);
      setFinished(full);
      setStage('done');
      setCart([]); setPayments({}); setCustomerName(''); setPanelOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function newOrder() {
    setFinished(null); setStage('shop'); setSearch(''); setFilters({});
  }

  // ============ Confirmación ============
  if (stage === 'done' && finished) {
    return (
      <div className="page">
        <header className="page-head no-print">
          <div>
            <h1>Pedido finalizado</h1>
            <p className="page-sub">Pedido Nº {finished.number} registrado.</p>
          </div>
          <div className="page-actions">
            <button className="btn ghost" onClick={newOrder}>Nuevo pedido</button>
            <button className="btn primary" onClick={() => window.print()}>Imprimir pedido</button>
          </div>
        </header>
        <div className="receipt-wrap">
          <OrderReceipt business={business} order={finished} />
        </div>
        <div className="no-print" style={{ textAlign: 'center', marginTop: 20 }}>
          <button className="btn primary lg" onClick={newOrder}>+ Nuevo pedido</button>
        </div>
      </div>
    );
  }

  const rateBadge = rateError && !rate.value
    ? <span className="rate-chip warn">Sin tasa · configúrala en Negocio</span>
    : <Link to="/settings" className="rate-chip">{rate.label} · {money(rate.value)} Bs/$</Link>;

  return (
    <div className="page pos-page">
      <header className="page-head">
        <div>
          <h1>Pedidos</h1>
          <p className="page-sub">Toca un producto para agregarlo al pedido.</p>
        </div>
        <div className="page-actions">
          {rateBadge}
          <Link to="/orders/history" className="btn ghost">Historial</Link>
        </div>
      </header>

      {error && <div className="form-error no-print">{error}</div>}

      <div className="pos">
        {/* -------- Área principal: catálogo o resumen -------- */}
        <section className="pos-main">
          {stage === 'shop' ? (
            <>
              <div className="pos-toolbar">
                <input className="pos-search" placeholder="Buscar producto o SKU…"
                  value={search} onChange={(e) => setSearch(e.target.value)} />
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
              </div>

              {products === null ? (
                <div className="empty">Cargando…</div>
              ) : visible.length === 0 ? (
                <div className="empty">
                  {products.length === 0
                    ? <>Aún no tienes productos. Agrégalos en <Link to="/inventory">Inventario</Link>.</>
                    : 'Ningún producto coincide con la búsqueda.'}
                </div>
              ) : (
                <div className="product-grid">
                  {visible.map((p) => {
                    const inCart = cart.find((c) => c.id === p.id);
                    return (
                      <button key={p.id} className={`product-card${inCart ? ' in-cart' : ''}`} onClick={() => addToCart(p)}>
                        {inCart && <span className="product-qty-badge">{inCart.qty}</span>}
                        <div className="product-card-name">{p.name}</div>
                        <div className="product-card-meta">
                          <span className={`stock-badge${Number(p.stock) <= 0 ? ' out' : ''}`}>
                            {Number(p.stock)} {p.unit}
                          </span>
                        </div>
                        <div className="product-card-prices">
                          <strong>{usd(p.price)}</strong>
                          <span className="product-card-bs">{bs(Number(p.price) * rate.value)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            /* -------- Resumen del pedido (etapa de pago) -------- */
            <div className="card order-summary">
              <div className="order-summary-head">
                <h2>Resumen del pedido</h2>
                <button className="btn ghost sm" onClick={() => setStage('shop')}>← Seguir agregando</button>
              </div>
              <table className="list">
                <tbody>
                  {cart.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.name}
                        <div className="muted">{c.qty} × {usd(c.price)}</div>
                      </td>
                      <td className="num">
                        <div>{usd(c.price * c.qty)}</div>
                        <div className="muted">{bs(c.price * c.qty * rate.value)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <label className="order-customer">
                Cliente (opcional)
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nombre del cliente" />
              </label>
            </div>
          )}
        </section>

        {/* -------- Panel lateral: pedido o pago -------- */}
        <aside className={`pos-panel${panelOpen ? ' open' : ''}`}>
          {/* Barra resumen (móvil) para abrir/cerrar la hoja */}
          <button className="pos-panel-bar" onClick={() => setPanelOpen((v) => !v)}>
            <span>{cartCount} {cartCount === 1 ? 'artículo' : 'artículos'}</span>
            <span>{usd(totalUsd)} · {bs(totalVes)}</span>
          </button>

          <div className="pos-panel-body">
            {stage === 'shop' ? (
              <>
                <div className="pos-panel-head">
                  <h2>Pedido</h2>
                  {cart.length > 0 && <button className="btn ghost sm" onClick={() => setCart([])}>Vaciar</button>}
                </div>
                {cart.length === 0 ? (
                  <div className="pos-panel-empty">Aún no has agregado productos.</div>
                ) : (
                  <div className="cart-lines">
                    {cart.map((c) => (
                      <div className="cart-line" key={c.id}>
                        <div className="cart-line-info">
                          <div className="cart-line-name">{c.name}</div>
                          <div className="muted">{usd(c.price)} · {bs(c.price * rate.value)}</div>
                        </div>
                        <div className="qty-stepper">
                          <button onClick={() => setQty(c.id, c.qty - 1)} aria-label="Quitar uno">−</button>
                          <input value={c.qty} inputMode="numeric"
                            onChange={(e) => setQty(c.id, Math.max(0, parseInt(e.target.value, 10) || 0))} />
                          <button onClick={() => setQty(c.id, c.qty + 1)} aria-label="Agregar uno">+</button>
                        </div>
                        <div className="cart-line-total">{usd(c.price * c.qty)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="pos-panel-head">
                  <h2>Pago</h2>
                </div>
                <div className="pay-methods">
                  {methods.length === 0 && (
                    <div className="pos-panel-empty">
                      No hay métodos de pago. Agrégalos en <Link to="/settings">Negocio → Pedidos</Link>.
                    </div>
                  )}
                  {methods.map((m) => (
                    <div className="pay-method" key={m.id}>
                      <div className="pay-method-head">
                        <span className="pay-method-name">{m.name}</span>
                        <span className="pay-method-cur">{m.currency === 'USD' ? '$' : 'Bs'}</span>
                      </div>
                      <div className="pay-method-input">
                        <input inputMode="decimal" placeholder="0,00" value={payments[m.id] || ''}
                          onChange={(e) => setPayments((prev) => ({ ...prev, [m.id]: e.target.value }))} />
                        <button type="button" className="btn ghost sm" onClick={() => fillExact(m)}>Exacto</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Totales y acción */}
            <div className="pos-panel-foot">
              <div className="totals">
                <div className="totals-row grand"><span>Total</span><span>{usd(totalUsd)}</span></div>
                <div className="totals-row"><span>Total Bs</span><span>{bs(totalVes)}</span></div>
                {stage === 'pay' && (
                  <>
                    <div className="totals-row"><span>Pagado</span><span>{usd(paidUsd)}</span></div>
                    {remainingUsd > 0.001
                      ? <div className="totals-row warn"><span>Restante</span><span>{usd(remainingUsd)}</span></div>
                      : changeUsd > 0.001 && <div className="totals-row ok"><span>Vuelto</span><span>{usd(changeUsd)}</span></div>}
                  </>
                )}
              </div>
              {stage === 'shop' ? (
                <button className="btn primary lg block" disabled={cart.length === 0}
                  onClick={() => { setStage('pay'); setPanelOpen(true); }}>
                  Ir al pago
                </button>
              ) : (
                <button className="btn primary lg block" disabled={busy || remainingUsd > 0.001 || cart.length === 0}
                  onClick={onFinish}>
                  {busy ? 'Guardando…' : 'Finalizar pedido'}
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
