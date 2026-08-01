import { Fragment, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  fetchProducts, createProduct, deleteProduct,
  fetchMovements, createMovement,
  fetchTaxonomies, findOrCreateTerm, setProductTerms,
  createVariant, deleteVariant,
} from '../lib/api';
import { money, formatDate, variantLabel } from '../lib/calc';

const MOVE_LABELS = { in: 'Entrada', out: 'Salida', adjustment: 'Ajuste' };

// Producto cartesiano de [[a,b],[1,2]] → [[a,1],[a,2],[b,1],[b,2]]
function cartesian(lists) {
  return lists.reduce((acc, list) => acc.flatMap((combo) => list.map((v) => [...combo, v])), [[]]);
}

const variantsOf = (p) => p.product_variants || [];
const totalStock = (p) => variantsOf(p).reduce((s, v) => s + Number(v.stock || 0), 0);
const isSimple = (p) => variantsOf(p).length <= 1 && (p.variant_axes || []).length === 0;
const defaultVariant = (p) =>
  variantsOf(p).find((v) => Object.keys(v.attributes || {}).length === 0) || variantsOf(p)[0];

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

  // taxonomías del negocio (Marca, Modelo, Talla, Color…)
  const [taxonomies, setTaxonomies] = useState([]);
  const [termValues, setTermValues] = useState({});   // { taxonomyId: 'Toyota' } etiquetas del producto
  const [axisIds, setAxisIds] = useState([]);          // taxonomías usadas como eje de variante
  const [axisValues, setAxisValues] = useState({});    // { taxonomyId: 'S, M, L' }
  const [filters, setFilters] = useState({});          // { taxonomyId: termId } sobre la lista

  const [expanded, setExpanded] = useState({});        // { productId: true } desglose de variantes
  // movimiento en curso: { productId, variantId, label, type, quantity, note }
  const [move, setMove] = useState(null);
  // alta de variante en un producto existente: { productId, values: {taxName: ''} }
  const [addVar, setAddVar] = useState(null);

  async function reload() {
    const [p, m, t] = await Promise.all([fetchProducts(), fetchMovements(), fetchTaxonomies()]);
    setProducts(p); setMovements(m); setTaxonomies(t);
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);

  const toggleAxis = (id) =>
    setAxisIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function onAddProduct(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const axisTaxonomies = taxonomies.filter((t) => axisIds.includes(t.id));
      const axisNames = axisTaxonomies.map((t) => t.name);

      const created = await createProduct(business.id, {
        name: pName.trim(), sku: pSku.trim(), unit: pUnit.trim() || 'und',
        price: Number(pPrice) || 0, variantAxes: axisNames,
      });

      // Etiquetas del producto: taxonomías que NO son eje de variante.
      const termIds = [];
      for (const t of taxonomies) {
        if (axisIds.includes(t.id)) continue;
        const value = (termValues[t.id] || '').trim();
        if (!value) continue;
        const term = await findOrCreateTerm(t.id, value);
        termIds.push(term.id);
      }
      await setProductTerms(created.id, termIds);

      // Variantes: producto cartesiano de los valores de cada eje.
      if (axisTaxonomies.length > 0) {
        const valuesPerAxis = axisTaxonomies.map((t) =>
          (axisValues[t.id] || '').split(',').map((v) => v.trim()).filter(Boolean));
        if (valuesPerAxis.some((vs) => vs.length === 0)) {
          throw new Error('Escribe al menos un valor para cada eje de variante (separados por coma).');
        }
        for (const combo of cartesian(valuesPerAxis)) {
          const attributes = {};
          combo.forEach((val, i) => { attributes[axisNames[i]] = val; });
          await createVariant(business.id, created.id, { attributes });
          // Alimenta el vocabulario de la taxonomía para autocompletar luego.
          for (let i = 0; i < axisTaxonomies.length; i++) {
            await findOrCreateTerm(axisTaxonomies[i].id, combo[i]);
          }
        }
      } else {
        // Producto simple: una variante por defecto.
        await createVariant(business.id, created.id, { attributes: {}, sku: pSku.trim() });
      }

      await reload();
      setPName(''); setPSku(''); setPUnit('und'); setPPrice('');
      setTermValues({}); setAxisIds([]); setAxisValues({});
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
    if (!confirm(`¿Eliminar ${p.name}, sus variantes y su historial de movimientos?`)) return;
    try {
      await deleteProduct(p.id);
      await reload();
    } catch (e) {
      setError(e.message);
    }
  }

  async function onDeleteVariant(p, v) {
    if (variantsOf(p).length <= 1) { setError('Un producto debe tener al menos una variante.'); return; }
    if (!confirm(`¿Eliminar la variante ${variantLabel(v.attributes) || 'estándar'} de ${p.name}?`)) return;
    try {
      await deleteVariant(v.id);
      await reload();
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
        productId: move.productId, variantId: move.variantId, type: move.type,
        quantity: Number(move.quantity), note: move.note.trim(),
      });
      await reload();
      setMove(null);
    } catch (err) {
      setError(err.message.includes('Insufficient stock') ? 'No hay stock suficiente para esa salida.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitAddVariant(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const p = products.find((x) => x.id === addVar.productId);
      const axes = p.variant_axes || [];
      const attributes = {};
      for (const ax of axes) {
        const val = (addVar.values[ax] || '').trim();
        if (!val) throw new Error(`Falta el valor de ${ax}.`);
        attributes[ax] = val;
      }
      await createVariant(business.id, p.id, { attributes });
      await reload();
      setAddVar(null);
    } catch (err) {
      setError(err.message.includes('duplicate') || err.message.includes('unique')
        ? 'Ya existe una variante con esa combinación.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  const moveButtons = (p, v) => (
    <>
      <button className="btn ghost sm" onClick={() => setMove({ productId: p.id, variantId: v.id, label: variantLabel(v.attributes), type: 'in', quantity: '', note: '' })}>+ Entrada</button>
      <button className="btn ghost sm" onClick={() => setMove({ productId: p.id, variantId: v.id, label: variantLabel(v.attributes), type: 'out', quantity: '', note: '' })}>− Salida</button>
      <button className="btn ghost sm" onClick={() => setMove({ productId: p.id, variantId: v.id, label: variantLabel(v.attributes), type: 'adjustment', quantity: String(v.stock), note: '' })}>Ajustar</button>
    </>
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Inventario</h1>
          <p className="page-sub">Productos, variantes y movimientos de stock.</p>
        </div>
      </header>

      <div className="card vsection">
        <h2>Nuevo producto</h2>
        <form onSubmit={onAddProduct} className="vform">
          <div className="inline-form">
            <label>
              Nombre
              <input value={pName} onChange={(e) => setPName(e.target.value)} required placeholder="Camisa Oxford" />
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
                <input value={pSku} onChange={(e) => setPSku(e.target.value)} placeholder="CAM-OXF" />
              </label>
              <label>
                Unidad de medida
                <input value={pUnit} onChange={(e) => setPUnit(e.target.value)} placeholder="und, kg, cajas…" />
              </label>
              {taxonomies.filter((t) => !axisIds.includes(t.id)).map((t) => (
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

            {/* -------- Variantes -------- */}
            <div className="variant-config">
              <div className="oc-label">Variantes (color, talla…)</div>
              <p className="hint">Marca los ejes por los que varía este producto; se creará una variante por cada combinación.</p>
              <div className="variant-axis-pills">
                {taxonomies.map((t) => (
                  <button type="button" key={t.id}
                    className={`pay-pill${axisIds.includes(t.id) ? ' active' : ''}`}
                    onClick={() => toggleAxis(t.id)}>
                    {t.name}
                  </button>
                ))}
                {taxonomies.length === 0 && (
                  <span className="muted">Crea taxonomías (Talla, Color…) en <a href="/settings">Negocio</a>.</span>
                )}
              </div>
              {axisIds.length > 0 && (
                <div className="vgrid">
                  {taxonomies.filter((t) => axisIds.includes(t.id)).map((t) => (
                    <label key={t.id}>
                      {t.name} (valores separados por coma)
                      <input list={`axis-${t.id}`} value={axisValues[t.id] || ''}
                        onChange={(e) => setAxisValues((v) => ({ ...v, [t.id]: e.target.value }))}
                        placeholder={t.name === 'Talla' ? 'S, M, L, XL' : t.name === 'Color' ? 'Negro, Blanco, Azul' : ''} />
                      <datalist id={`axis-${t.id}`}>
                        {t.taxonomy_terms.map((term) => <option key={term.id} value={term.name} />)}
                      </datalist>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <p className="hint">
              El valor se crea solo si no existe. Gestiona las categorías en <a href="/settings">Negocio</a>.
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
              {visibleProducts.map((p) => {
                const simple = isSimple(p);
                const dv = defaultVariant(p);
                const open = expanded[p.id];
                return (
                  <Fragment key={p.id}>
                    <tr>
                      <td>
                        {!simple && (
                          <button className="tree-toggle" onClick={() => setExpanded((s) => ({ ...s, [p.id]: !s[p.id] }))}>
                            {open ? '▾' : '▸'}
                          </button>
                        )}
                        {p.name}
                        {!simple && <span className="variant-count">{variantsOf(p).length} variantes</span>}
                        {(p.product_terms || []).length > 0 && (
                          <div className="product-tags">
                            {p.product_terms.map((pt) => termName.get(pt.term_id)).filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="mono">{p.sku}</td>
                      <td className="num">{money(p.price)}</td>
                      <td className="num"><strong>{totalStock(p)}</strong> {p.unit}</td>
                      <td className="row-actions">
                        {simple && dv ? (
                          moveButtons(p, dv)
                        ) : (
                          <button className="btn ghost sm" onClick={() => setExpanded((s) => ({ ...s, [p.id]: !s[p.id] }))}>
                            {open ? 'Ocultar' : 'Ver variantes'}
                          </button>
                        )}
                        <button className="btn danger sm" onClick={() => onDeleteProduct(p)}>Eliminar</button>
                      </td>
                    </tr>
                    {!simple && open && variantsOf(p).map((v) => (
                      <tr key={v.id} className="variant-row">
                        <td className="variant-cell">↳ {variantLabel(v.attributes, p.variant_axes) || 'Estándar'}</td>
                        <td className="mono">{v.sku}</td>
                        <td className="num">{v.price != null ? money(v.price) : <span className="muted">{money(p.price)}</span>}</td>
                        <td className="num"><strong>{Number(v.stock)}</strong> {p.unit}</td>
                        <td className="row-actions">
                          {moveButtons(p, v)}
                          <button className="btn danger sm" onClick={() => onDeleteVariant(p, v)}>Quitar</button>
                        </td>
                      </tr>
                    ))}
                    {!simple && open && (
                      <tr className="variant-row">
                        <td colSpan={5}>
                          <button className="btn ghost sm" onClick={() =>
                            setAddVar({ productId: p.id, values: Object.fromEntries((p.variant_axes || []).map((a) => [a, ''])) })}>
                            + Agregar variante
                          </button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
              {move.label && <span className="muted"> · {move.label}</span>}
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

      {addVar && (
        <div className="modal-backdrop" onClick={() => setAddVar(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>Nueva variante — {products.find((p) => p.id === addVar.productId)?.name}</h2>
            <form onSubmit={onSubmitAddVariant} className="vform">
              {(products.find((p) => p.id === addVar.productId)?.variant_axes || []).map((ax) => (
                <label key={ax}>
                  {ax}
                  <input autoFocus required value={addVar.values[ax] || ''}
                    onChange={(e) => setAddVar((s) => ({ ...s, values: { ...s.values, [ax]: e.target.value } }))} />
                </label>
              ))}
              <div className="inline-form-actions">
                <button className="btn primary" disabled={busy}>Crear variante</button>
                <button type="button" className="btn ghost" onClick={() => setAddVar(null)}>Cancelar</button>
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
                {movements.map((m) => {
                  const vlabel = variantLabel(m.product_variants?.attributes);
                  return (
                    <tr key={m.id}>
                      <td>{formatDate(m.created_at)}</td>
                      <td>{m.products?.name ?? '—'}{vlabel && <span className="muted"> · {vlabel}</span>}</td>
                      <td><span className={`badge ${m.type}`}>{MOVE_LABELS[m.type]}</span></td>
                      <td className="num">{Number(m.quantity)}</td>
                      <td className="muted">{m.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
