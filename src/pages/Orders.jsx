import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  fetchProducts, fetchTaxonomies, fetchPaymentMethods, fetchCustomers,
  createCustomer, createOrder, fetchOrder, mediaUrl,
} from '../lib/api';
import { fetchBcvRates, resolveRate } from '../lib/rates';
import { usd, bs, money, variantLabel } from '../lib/calc';
import OrderReceipt from '../components/OrderReceipt';

const EMPTY_CUST = { name: '', document: '', phone: '', email: '' };

const variantsOf = (p) => p.product_variants || [];
const totalStock = (p) => variantsOf(p).reduce((s, v) => s + Number(v.stock || 0), 0);
const isSimple = (p) => variantsOf(p).length <= 1 && (p.variant_axes || []).length === 0;
const defaultVariant = (p) =>
  variantsOf(p).find((v) => Object.keys(v.attributes || {}).length === 0) || variantsOf(p)[0];
const variantPrice = (p, v) => (v.price != null ? Number(v.price) : Number(p.price));
const mediaOf = (p) => (p.product_media || []).slice().sort((a, b) => a.sort_order - b.sort_order);
const productImg = (p) => { const m = mediaOf(p).find((x) => !x.variant_id) || mediaOf(p)[0]; return m ? mediaUrl(m) : null; };
const variantImg = (p, v) => {
  const m = mediaOf(p).find((x) => x.variant_id === v.id);
  return m ? mediaUrl(m) : productImg(p);
};

export default function Orders() {
  const { business } = useAuth();
  const [products, setProducts] = useState(null);
  const [taxonomies, setTaxonomies] = useState([]);
  const [methods, setMethods] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [rates, setRates] = useState(null);
  const [rateError, setRateError] = useState(null);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});          // { taxonomyId: termId }

  const [cart, setCart] = useState([]);                // [{ id(variantId), productId, name, label, price, unit, stock, qty }]
  const [picker, setPicker] = useState(null);          // producto cuyo selector de variante está abierto
  const [stage, setStage] = useState('shop');          // 'shop' | 'pay' | 'done'
  const [panelOpen, setPanelOpen] = useState(false);   // hoja inferior en móvil

  // Cliente del pedido: existente (selectedCustomer) o nuevo (newCust)
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [custSearch, setCustSearch] = useState('');
  const [showNewCust, setShowNewCust] = useState(false);
  const [newCust, setNewCust] = useState(EMPTY_CUST);

  const [selectedMethods, setSelectedMethods] = useState([]); // ids de métodos activos
  const [payments, setPayments] = useState({});        // { methodId: 'monto' }
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(null);      // pedido guardado (con ítems/pagos)

  useEffect(() => {
    Promise.all([fetchProducts(), fetchTaxonomies(), fetchPaymentMethods(), fetchCustomers()])
      .then(([p, t, m, c]) => {
        setProducts(p); setTaxonomies(t); setMethods(m.filter((x) => x.active)); setCustomers(c);
      })
      .catch((e) => setError(e.message));
    fetchBcvRates().then(setRates).catch((e) => setRateError(e.message));
  }, []);

  const rate = useMemo(() => resolveRate(business?.rate_config, rates), [business, rates]);

  // ------- carrito (por variante) -------
  const addVariant = (p, v) => {
    setCart((prev) => {
      const found = prev.find((c) => c.id === v.id);
      if (found) return prev.map((c) => (c.id === v.id ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, {
        id: v.id, productId: p.id, name: p.name, label: variantLabel(v.attributes, p.variant_axes),
        price: variantPrice(p, v), unit: p.unit, stock: Number(v.stock), qty: 1,
      }];
    });
  };
  // Tocar un producto: si es simple lo agrega directo; si tiene variantes abre el selector.
  const onTapProduct = (p) => {
    if (isSimple(p)) {
      const dv = defaultVariant(p);
      if (dv) addVariant(p, dv);
    } else {
      setPicker(p);
    }
  };
  const cartQtyForProduct = (p) => cart.filter((c) => c.productId === p.id).reduce((s, c) => s + c.qty, 0);
  const setQty = (id, qty) => {
    if (qty <= 0) return setCart((prev) => prev.filter((c) => c.id !== id));
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, qty } : c)));
  };
  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  const totalUsd = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const totalVes = totalUsd * rate.value;

  // ------- pagos (solo los métodos seleccionados) -------
  // Descuento por divisa: el pago en USD "rinde" más (amt / (1-d)); los Bs no.
  const d = Math.min(0.99, Math.max(0, (Number(business?.foreign_discount_percent) || 0) / 100));
  const vesCredit = selectedMethods.reduce((s, id) => {
    const m = methods.find((x) => x.id === id);
    if (!m || m.currency === 'USD') return s;
    const amt = Number(payments[id]) || 0;
    return s + (rate.value ? amt / rate.value : 0);
  }, 0);
  const usdPaid = selectedMethods.reduce((s, id) => {
    const m = methods.find((x) => x.id === id);
    if (!m || m.currency !== 'USD') return s;
    return s + (Number(payments[id]) || 0);
  }, 0);
  const paidUsd = vesCredit + (d > 0 ? usdPaid / (1 - d) : usdPaid);
  const remainingUsd = Math.max(0, totalUsd - paidUsd);
  const changeUsd = Math.max(0, paidUsd - totalUsd);
  // Descuento concedido (igual criterio que el servidor).
  const pendingForUsd = Math.max(0, totalUsd - vesCredit);
  const usdNeeded = pendingForUsd * (1 - d);
  const discountUsd = d <= 0 ? 0
    : (usdPaid + 0.005 >= usdNeeded ? pendingForUsd * d : (usdPaid * d) / (1 - d));

  const toggleMethod = (m) => {
    setSelectedMethods((prev) => {
      if (prev.includes(m.id)) {
        setPayments((p) => { const n = { ...p }; delete n[m.id]; return n; });
        return prev.filter((x) => x !== m.id);
      }
      return [...prev, m.id];
    });
  };

  const fillExact = (m) => {
    // Restante en USD (lista) sin contar lo ya escrito en este método.
    const creditOfThis = m.currency === 'USD'
      ? (d > 0 ? (Number(payments[m.id]) || 0) / (1 - d) : (Number(payments[m.id]) || 0))
      : (rate.value ? (Number(payments[m.id]) || 0) / rate.value : 0);
    const remaining = totalUsd - (paidUsd - creditOfThis);
    if (remaining <= 0) return;
    // En divisa se cobra el saldo con descuento: remaining*(1-d). En Bs, sin descuento.
    const amount = m.currency === 'USD' ? remaining * (1 - d) : remaining * rate.value;
    setPayments((prev) => ({ ...prev, [m.id]: amount.toFixed(2) }));
  };

  // ------- cliente -------
  const custMatches = custSearch.trim()
    ? customers.filter((c) => {
        const q = custSearch.trim().toLowerCase();
        return c.name.toLowerCase().includes(q) || (c.document || '').toLowerCase().includes(q);
      }).slice(0, 6)
    : [];

  const pickCustomer = (c) => { setSelectedCustomer(c); setCustSearch(''); setShowNewCust(false); };
  const setNew = (k) => (e) => setNewCust((f) => ({ ...f, [k]: e.target.value }));
  const resetCustomer = () => { setSelectedCustomer(null); setCustSearch(''); setShowNewCust(false); setNewCust(EMPTY_CUST); };

  // ------- categorías / filtros -------
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
      // Resuelve el cliente: existente, nuevo (se crea) o ninguno.
      let customerId = selectedCustomer?.id || null;
      let customerName = selectedCustomer?.name || '';
      if (!selectedCustomer && showNewCust && newCust.name.trim()) {
        const created = await createCustomer(business.id, {
          name: newCust.name.trim(), document: newCust.document.trim(),
          phone: newCust.phone.trim(), email: newCust.email.trim(),
        });
        setCustomers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        customerId = created.id; customerName = created.name;
      }

      const items = cart.map((c) => ({ variant_id: c.id, quantity: c.qty }));
      const pays = selectedMethods
        .map((id) => methods.find((x) => x.id === id))
        .filter(Boolean)
        .map((m) => ({ m, amount: Number(payments[m.id]) || 0 }))
        .filter((x) => x.amount > 0)
        .map((x) => ({ method_id: x.m.id, method_name: x.m.name, currency: x.m.currency, amount: x.amount }));

      const created = await createOrder({
        items, payments: pays, rate: rate.value, rateSource: rate.source, customerId, customerName,
      });
      const full = await fetchOrder(created.id);
      setFinished(full);
      setStage('done');
      setCart([]); setPayments({}); setSelectedMethods([]); resetCustomer(); setPanelOpen(false);
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
                    const qty = cartQtyForProduct(p);
                    const stock = totalStock(p);
                    const simple = isSimple(p);
                    const dv = simple ? defaultVariant(p) : null;
                    const img = productImg(p);
                    const inCartLine = dv ? cart.find((c) => c.id === dv.id) : null;
                    return (
                      <div key={p.id} className={`product-card${qty ? ' in-cart' : ''}`}
                        onClick={() => { if (!(simple && inCartLine)) onTapProduct(p); }}
                        role="button" tabIndex={0}>
                        {qty > 0 && <span className="product-qty-badge">{qty}</span>}
                        <div className="product-card-thumb">
                          {img ? <img src={img} alt="" loading="lazy" /> : <span className="thumb-ph">{p.name.slice(0, 1)}</span>}
                        </div>
                        <div className="product-card-name">{p.name}</div>
                        <div className="product-card-meta">
                          <span className={`stock-badge${stock <= 0 ? ' out' : ''}`}>{stock} {p.unit}</span>
                          {!simple && <span className="variant-count">{variantsOf(p).length} variantes</span>}
                        </div>
                        <div className="product-card-prices">
                          <strong>{usd(p.price)}</strong>
                          <span className="product-card-bs">{bs(Number(p.price) * rate.value)}</span>
                        </div>
                        {simple && inCartLine && (
                          <div className="qty-stepper card-stepper" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => setQty(dv.id, inCartLine.qty - 1)} aria-label="Quitar uno">−</button>
                            <input value={inCartLine.qty} inputMode="numeric"
                              onChange={(e) => setQty(dv.id, Math.max(0, parseInt(e.target.value, 10) || 0))} />
                            <button onClick={() => addVariant(p, dv)} aria-label="Agregar uno">+</button>
                          </div>
                        )}
                      </div>
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
                        {c.name}{c.label && <span className="muted"> · {c.label}</span>}
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

              {/* -------- Cliente: elegir existente o crear nuevo -------- */}
              <div className="order-customer-block">
                <div className="oc-label">Cliente (opcional)</div>
                {selectedCustomer ? (
                  <div className="oc-selected">
                    <div>
                      <strong>{selectedCustomer.name}</strong>
                      {selectedCustomer.document && <span className="muted"> · {selectedCustomer.document}</span>}
                    </div>
                    <button type="button" className="btn ghost sm" onClick={resetCustomer}>Quitar</button>
                  </div>
                ) : showNewCust ? (
                  <div className="oc-new">
                    <input placeholder="Nombre" value={newCust.name} onChange={setNew('name')} autoFocus />
                    <input placeholder="Documento (opcional)" value={newCust.document} onChange={setNew('document')} />
                    <input placeholder="Teléfono (opcional)" value={newCust.phone} onChange={setNew('phone')} inputMode="tel" />
                    <input placeholder="Correo (opcional)" value={newCust.email} onChange={setNew('email')} type="email" />
                    <button type="button" className="btn ghost sm" onClick={() => { setShowNewCust(false); setNewCust(EMPTY_CUST); }}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <>
                    <input className="oc-search" placeholder="Buscar cliente por nombre o documento…"
                      value={custSearch} onChange={(e) => setCustSearch(e.target.value)} />
                    {custMatches.length > 0 && (
                      <div className="oc-results">
                        {custMatches.map((c) => (
                          <button type="button" key={c.id} onClick={() => pickCustomer(c)}>
                            {c.name}{c.document && <span className="muted"> · {c.document}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    <button type="button" className="btn ghost sm" onClick={() => setShowNewCust(true)}>+ Nuevo cliente</button>
                  </>
                )}
              </div>
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
            <div className="pos-panel-scroll">
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
                            <div className="cart-line-name">{c.name}{c.label && <span className="muted"> · {c.label}</span>}</div>
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
                  {methods.length === 0 ? (
                    <div className="pos-panel-empty">
                      No hay métodos de pago. Agrégalos en <Link to="/settings">Negocio → Pedidos</Link>.
                    </div>
                  ) : (
                    <>
                      {/* Métodos como pills: se pueden seleccionar varios */}
                      <div className="pay-block">
                        <div className="pay-pills">
                          {methods.map((m) => (
                            <button type="button" key={m.id}
                              className={`pay-pill${selectedMethods.includes(m.id) ? ' active' : ''}`}
                              onClick={() => toggleMethod(m)}>
                              {m.name}
                              <span className="pay-pill-cur">{m.currency === 'USD' ? '$' : 'Bs'}</span>
                            </button>
                          ))}
                        </div>
                        {selectedMethods.length === 0 && (
                          <div className="pay-hint">Selecciona uno o varios métodos de pago.</div>
                        )}
                      </div>

                      {/* Un input por cada método seleccionado, debajo de la lista */}
                      {selectedMethods.length > 0 && (
                        <div className="pay-inputs">
                          {selectedMethods
                            .map((id) => methods.find((x) => x.id === id))
                            .filter(Boolean)
                            .map((m) => (
                              <div className="pay-input-row" key={m.id}>
                                <div className="pay-input-label">
                                  <span>{m.name}</span>
                                  <span className="muted">{m.currency === 'USD' ? 'USD' : 'Bs'}</span>
                                </div>
                                <div className="pay-input-controls">
                                  <input inputMode="decimal" placeholder="0,00" value={payments[m.id] || ''}
                                    onChange={(e) => setPayments((prev) => ({ ...prev, [m.id]: e.target.value }))} />
                                  <button type="button" className="btn ghost sm" onClick={() => fillExact(m)}>Exacto</button>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Totales y acción (fijos abajo) */}
            <div className="pos-panel-foot">
              <div className="totals">
                <div className="totals-row grand"><span>Total</span><span>{usd(totalUsd)}</span></div>
                <div className="totals-row"><span>Total Bs</span><span>{bs(totalVes)}</span></div>
                {stage === 'pay' && (
                  <>
                    {discountUsd > 0.005 && (
                      <div className="totals-row ok"><span>Descuento divisa</span><span>−{usd(discountUsd)}</span></div>
                    )}
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

      {/* -------- Selector de variante (color + talla) -------- */}
      {picker && (
        <div className="modal-backdrop" onClick={() => setPicker(null)}>
          <div className="modal card variant-picker" onClick={(e) => e.stopPropagation()}>
            <div className="pos-panel-head">
              <h2>{picker.name}</h2>
              <button className="btn ghost sm" onClick={() => setPicker(null)}>Listo</button>
            </div>
            <p className="page-sub">Elige la variante a agregar.</p>
            <div className="variant-pick-grid">
              {variantsOf(picker).map((v) => {
                const inCart = cart.find((c) => c.id === v.id);
                const out = Number(v.stock) <= 0;
                const img = variantImg(picker, v);
                return (
                  <div key={v.id} className={`variant-pick${inCart ? ' in-cart' : ''}`}
                    role="button" tabIndex={0}
                    onClick={() => { if (!inCart) addVariant(picker, v); }}>
                    {inCart && <span className="product-qty-badge">{inCart.qty}</span>}
                    <div className="product-card-thumb sm">
                      {img ? <img src={img} alt="" loading="lazy" /> : <span className="thumb-ph">{(variantLabel(v.attributes) || picker.name).slice(0, 1)}</span>}
                    </div>
                    <div className="variant-pick-label">{variantLabel(v.attributes, picker.variant_axes) || 'Estándar'}</div>
                    <div className="product-card-meta">
                      <span className={`stock-badge${out ? ' out' : ''}`}>{Number(v.stock)} {picker.unit}</span>
                    </div>
                    <div className="product-card-prices">
                      <strong>{usd(variantPrice(picker, v))}</strong>
                    </div>
                    {inCart && (
                      <div className="qty-stepper card-stepper" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setQty(v.id, inCart.qty - 1)} aria-label="Quitar uno">−</button>
                        <input value={inCart.qty} inputMode="numeric"
                          onChange={(e) => setQty(v.id, Math.max(0, parseInt(e.target.value, 10) || 0))} />
                        <button onClick={() => addVariant(picker, v)} aria-label="Agregar uno">+</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
