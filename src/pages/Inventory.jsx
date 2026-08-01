import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  fetchProducts, deleteProduct,
  fetchMovements, createMovement,
  fetchTaxonomies,
  createProductWithVariants, addProductVariant, updateVariant, deleteVariant,
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

const EMPTY_ROW = () => ({ key: Math.random().toString(36).slice(2), values: {}, stock: '', sku: '', price: '' });
const emptyNewProd = () => ({
  name: '', price: '', sku: '', unit: 'und',
  categories: {}, mode: 'simple', simpleStock: '',
  axisIds: [], genValues: {}, rows: [EMPTY_ROW()],
});

export default function Inventory() {
  const { business } = useAuth();
  const [products, setProducts] = useState(null);
  const [movements, setMovements] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [taxonomies, setTaxonomies] = useState([]);
  const [filters, setFilters] = useState({});         // { taxonomyId: termId } sobre la lista

  const [expanded, setExpanded] = useState({});       // { productId: true }
  const [move, setMove] = useState(null);             // { productId, variantId, label, type, quantity, note }
  const [addVar, setAddVar] = useState(null);         // { productId, values, stock, sku, price }
  const [varEdit, setVarEdit] = useState(null);       // { id, productName, label, sku, price, target }
  const [newProd, setNewProd] = useState(null);       // modal de alta

  const catTax = taxonomies.filter((t) => t.kind !== 'variant');
  const varTax = taxonomies.filter((t) => t.kind === 'variant');

  const lowPct = Number(business?.low_stock_percent) || 0;
  const isLow = (v) => {
    const t = Number(v.target_stock);
    return v.target_stock != null && t > 0 && Number(v.stock) <= (t * lowPct) / 100;
  };
  const productHasLow = (p) => variantsOf(p).some(isLow);

  async function reload() {
    const [p, m, t] = await Promise.all([fetchProducts(), fetchMovements(), fetchTaxonomies()]);
    setProducts(p); setMovements(m); setTaxonomies(t);
  }
  useEffect(() => { reload().catch((e) => setError(e.message)); }, []);

  // nombre de cada término, para etiquetas y filtros
  const termName = new Map();
  taxonomies.forEach((t) => t.taxonomy_terms.forEach((term) => termName.set(term.id, term.name)));

  const visibleProducts = (products || []).filter((p) =>
    Object.entries(filters).every(([, termId]) =>
      !termId || (p.product_terms || []).some((pt) => pt.term_id === termId))
  );
  const filterables = taxonomies.filter((t) => t.taxonomy_terms.length > 0);

  // ---------- Alta de producto ----------
  const np = newProd;
  const setNp = (patch) => setNewProd((s) => ({ ...s, ...patch }));
  const axisTaxOfNew = () => varTax.filter((t) => np.axisIds.includes(t.id));

  function toggleNewAxis(id) {
    setNewProd((s) => {
      const on = s.axisIds.includes(id);
      const axisIds = on ? s.axisIds.filter((x) => x !== id) : [...s.axisIds, id];
      // al cambiar ejes, limpiamos las filas para evitar valores huérfanos
      return { ...s, axisIds, rows: [EMPTY_ROW()], genValues: {} };
    });
  }
  function genCombinations() {
    const axes = axisTaxOfNew();
    const valuesPerAxis = axes.map((t) =>
      (np.genValues[t.id] || '').split(',').map((v) => v.trim()).filter(Boolean));
    if (valuesPerAxis.some((vs) => vs.length === 0)) {
      setError('Escribe al menos un valor para cada eje antes de generar.');
      return;
    }
    setError(null);
    const rows = cartesian(valuesPerAxis).map((combo) => {
      const values = {};
      axes.forEach((t, i) => { values[t.name] = combo[i]; });
      return { ...EMPTY_ROW(), values };
    });
    setNp({ rows });
  }

  async function onCreateProduct(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const categories = {};
      for (const t of catTax) {
        const val = (np.categories[t.id] || '').trim();
        if (val) categories[t.name] = val;
      }

      let variants;
      let variantAxes = [];
      if (np.mode === 'simple') {
        variants = [{ attributes: {}, stock: Number(np.simpleStock) || 0 }];
      } else {
        const axes = axisTaxOfNew();
        if (axes.length === 0) throw new Error('Elige al menos un eje de variación (Color, Talla…).');
        variantAxes = axes.map((t) => t.name);
        const seen = new Set();
        variants = np.rows.map((r) => {
          const attributes = {};
          for (const t of axes) {
            const val = (r.values[t.name] || '').trim();
            if (!val) throw new Error('Cada variación debe tener todos sus valores (Color, Talla…).');
            attributes[t.name] = val;
          }
          const sig = axes.map((t) => attributes[t.name]).join('|');
          if (seen.has(sig)) throw new Error(`Variación repetida: ${axes.map((t) => attributes[t.name]).join(' · ')}.`);
          seen.add(sig);
          return {
            attributes, stock: Number(r.stock) || 0,
            sku: r.sku.trim(), price: r.price === '' ? null : Number(r.price),
          };
        });
        if (variants.length === 0) throw new Error('Agrega al menos una variación.');
      }

      await createProductWithVariants({
        name: np.name.trim(), sku: np.sku.trim(), unit: np.unit.trim() || 'und',
        price: Number(np.price) || 0, categories, variantAxes, variants,
      });
      await reload();
      setNewProd(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // ---------- Variaciones de un producto existente ----------
  async function onSubmitAddVariant(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const p = products.find((x) => x.id === addVar.productId);
      const attributes = {};
      for (const ax of (p.variant_axes || [])) {
        const val = (addVar.values[ax] || '').trim();
        if (!val) throw new Error(`Falta el valor de ${ax}.`);
        attributes[ax] = val;
      }
      await addProductVariant(p.id, {
        attributes, sku: addVar.sku.trim(),
        price: addVar.price === '' ? null : Number(addVar.price), stock: Number(addVar.stock) || 0,
      });
      await reload();
      setAddVar(null);
    } catch (err) {
      setError(err.message.includes('duplicate') || err.message.includes('unique')
        ? 'Ya existe una variación con esa combinación.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitVarEdit(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await updateVariant(varEdit.id, {
        sku: varEdit.sku.trim(),
        price: varEdit.price === '' ? null : Number(varEdit.price),
        target_stock: varEdit.target === '' ? null : Number(varEdit.target),
      });
      await reload();
      setVarEdit(null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const openEdit = (p, v) => setVarEdit({
    id: v.id, productName: p.name, label: variantLabel(v.attributes, p.variant_axes),
    sku: v.sku || '', price: v.price != null ? String(v.price) : '',
    target: v.target_stock != null ? String(v.target_stock) : '',
  });

  async function onDeleteProduct(p) {
    if (!confirm(`¿Eliminar ${p.name}, sus variantes y su historial de movimientos?`)) return;
    try { await deleteProduct(p.id); await reload(); } catch (e) { setError(e.message); }
  }
  async function onDeleteVariant(p, v) {
    if (variantsOf(p).length <= 1) { setError('Un producto debe tener al menos una variante.'); return; }
    if (!confirm(`¿Eliminar la variante ${variantLabel(v.attributes) || 'estándar'} de ${p.name}?`)) return;
    try { await deleteVariant(v.id); await reload(); } catch (e) { setError(e.message); }
  }
  async function onSubmitMove(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await createMovement(business.id, {
        productId: move.productId, variantId: move.variantId, type: move.type,
        quantity: Number(move.quantity), note: move.note.trim(),
      });
      await reload();
      setMove(null);
    } catch (err) {
      setError(err.message.includes('Insufficient stock') ? 'No hay stock suficiente para esa salida.' : err.message);
    } finally { setBusy(false); }
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
        <div className="page-actions">
          <Link to="/inventory/history" className="btn ghost">Historial completo</Link>
          <button className="btn primary" onClick={() => { setError(null); setNewProd(emptyNewProd()); }}>+ Nuevo producto</button>
        </div>
      </header>

      {products && (() => {
        const low = products.flatMap((p) => variantsOf(p).filter(isLow).map((v) => ({ p, v })));
        if (low.length === 0) return null;
        return (
          <div className="lowstock-banner">
            <strong>⚠ {low.length} {low.length === 1 ? 'variante con' : 'variantes con'} stock bajo</strong>
            <span className="muted"> · {low.slice(0, 6).map(({ p, v }) =>
              `${p.name}${variantLabel(v.attributes) ? ' (' + variantLabel(v.attributes) + ')' : ''}: ${Number(v.stock)}`).join(' · ')}
              {low.length > 6 ? '…' : ''}</span>
          </div>
        );
      })()}

      {error && !newProd && <div className="form-error">{error}</div>}

      {products === null ? (
        <div className="empty">Cargando…</div>
      ) : products.length === 0 ? (
        <div className="empty">Aún no tienes productos. Usa <strong>+ Nuevo producto</strong> para agregar el primero.</div>
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
                      <td className="num">
                        <strong>{totalStock(p)}</strong> {p.unit}
                        {simple && dv && isLow(dv) && <span className="badge low">Bajo</span>}
                        {!simple && productHasLow(p) && <span className="badge low">Bajo</span>}
                      </td>
                      <td className="row-actions">
                        {simple && dv ? (
                          <>
                            {moveButtons(p, dv)}
                            <button className="btn ghost sm" onClick={() => openEdit(p, dv)}>Editar</button>
                          </>
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
                        <td className="num">
                          <strong>{Number(v.stock)}</strong> {p.unit}
                          {isLow(v) && <span className="badge low">Bajo</span>}
                          {v.target_stock != null && <div className="muted">objetivo {Number(v.target_stock)}</div>}
                        </td>
                        <td className="row-actions">
                          {moveButtons(p, v)}
                          <button className="btn ghost sm" onClick={() => openEdit(p, v)}>Editar</button>
                          <button className="btn danger sm" onClick={() => onDeleteVariant(p, v)}>Quitar</button>
                        </td>
                      </tr>
                    ))}
                    {!simple && open && (
                      <tr className="variant-row">
                        <td colSpan={5}>
                          <button className="btn ghost sm" onClick={() =>
                            setAddVar({ productId: p.id, values: Object.fromEntries((p.variant_axes || []).map((a) => [a, ''])), stock: '', sku: '', price: '' })}>
                            + Agregar variación
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

      {/* ============ Modal: nuevo producto ============ */}
      {newProd && (
        <div className="modal-backdrop" onClick={() => setNewProd(null)}>
          <div className="modal card modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="pos-panel-head">
              <h2>Nuevo producto</h2>
              <button className="btn ghost sm" onClick={() => setNewProd(null)}>Cerrar</button>
            </div>
            <form onSubmit={onCreateProduct} className="vform">
              <div className="np-grid">
                <label className="np-name">Nombre
                  <input value={np.name} onChange={(e) => setNp({ name: e.target.value })} required autoFocus placeholder="Camisa Oxford" />
                </label>
                <label>Precio (USD)
                  <input type="number" step="0.01" min="0" value={np.price} onChange={(e) => setNp({ price: e.target.value })} placeholder="0,00" />
                </label>
                <label>SKU
                  <input value={np.sku} onChange={(e) => setNp({ sku: e.target.value })} placeholder="CAM-OXF" />
                </label>
                <label>Unidad
                  <input value={np.unit} onChange={(e) => setNp({ unit: e.target.value })} placeholder="und" />
                </label>
              </div>

              {catTax.length > 0 && (
                <div className="np-block">
                  <div className="oc-label">Categorías</div>
                  <div className="np-grid">
                    {catTax.map((t) => (
                      <label key={t.id}>{t.name}
                        <input list={`cat-${t.id}`} value={np.categories[t.id] || ''}
                          onChange={(e) => setNp({ categories: { ...np.categories, [t.id]: e.target.value } })}
                          placeholder={t.name === 'Categoría' ? 'Camisas' : ''} />
                        <datalist id={`cat-${t.id}`}>
                          {t.taxonomy_terms.map((term) => <option key={term.id} value={term.name} />)}
                        </datalist>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="np-block">
                <div className="seg">
                  <button type="button" className={`seg-btn${np.mode === 'simple' ? ' active' : ''}`} onClick={() => setNp({ mode: 'simple' })}>Producto simple</button>
                  <button type="button" className={`seg-btn${np.mode === 'variants' ? ' active' : ''}`} onClick={() => setNp({ mode: 'variants' })}>Con variaciones</button>
                </div>

                {np.mode === 'simple' ? (
                  <label className="short" style={{ marginTop: 12 }}>Stock inicial
                    <input type="number" step="0.01" min="0" value={np.simpleStock}
                      onChange={(e) => setNp({ simpleStock: e.target.value })} placeholder="0" />
                  </label>
                ) : (
                  <div className="np-variants">
                    {varTax.length === 0 ? (
                      <p className="hint">No hay ejes de variación configurados. Créalos en <Link to="/settings">Negocio → Inventario → Variaciones</Link> (p. ej. Color, Talla).</p>
                    ) : (
                      <>
                        <div className="oc-label">Varía por</div>
                        <div className="variant-axis-pills">
                          {varTax.map((t) => (
                            <button type="button" key={t.id}
                              className={`pay-pill${np.axisIds.includes(t.id) ? ' active' : ''}`}
                              onClick={() => toggleNewAxis(t.id)}>{t.name}</button>
                          ))}
                        </div>

                        {axisTaxOfNew().length > 0 && (
                          <>
                            <div className="np-gen">
                              {axisTaxOfNew().map((t) => (
                                <label key={t.id} className="short">{t.name} (coma)
                                  <input list={`gen-${t.id}`} value={np.genValues[t.id] || ''}
                                    onChange={(e) => setNp({ genValues: { ...np.genValues, [t.id]: e.target.value } })}
                                    placeholder={t.name === 'Talla' ? 'S, M, L' : t.name === 'Color' ? 'Negro, Blanco' : ''} />
                                  <datalist id={`gen-${t.id}`}>
                                    {t.taxonomy_terms.map((term) => <option key={term.id} value={term.name} />)}
                                  </datalist>
                                </label>
                              ))}
                              <button type="button" className="btn sm" onClick={genCombinations}>Generar combinaciones</button>
                            </div>

                            <div className="var-rows">
                              <div className="var-rows-head">
                                {axisTaxOfNew().map((t) => <span key={t.id}>{t.name}</span>)}
                                <span>Stock</span><span>SKU</span><span>Precio</span><span />
                              </div>
                              {np.rows.map((r, i) => (
                                <div className="var-row" key={r.key}>
                                  {axisTaxOfNew().map((t) => (
                                    <input key={t.id} list={`row-${t.id}`} value={r.values[t.name] || ''}
                                      placeholder={t.name}
                                      onChange={(e) => setNp({ rows: np.rows.map((x, j) => j === i ? { ...x, values: { ...x.values, [t.name]: e.target.value } } : x) })} />
                                  ))}
                                  <input type="number" min="0" step="1" value={r.stock} placeholder="0"
                                    onChange={(e) => setNp({ rows: np.rows.map((x, j) => j === i ? { ...x, stock: e.target.value } : x) })} />
                                  <input value={r.sku} placeholder="opcional"
                                    onChange={(e) => setNp({ rows: np.rows.map((x, j) => j === i ? { ...x, sku: e.target.value } : x) })} />
                                  <input type="number" min="0" step="0.01" value={r.price} placeholder="hereda"
                                    onChange={(e) => setNp({ rows: np.rows.map((x, j) => j === i ? { ...x, price: e.target.value } : x) })} />
                                  <button type="button" className="var-row-del" aria-label="Quitar"
                                    onClick={() => setNp({ rows: np.rows.length > 1 ? np.rows.filter((_, j) => j !== i) : [EMPTY_ROW()] })}>×</button>
                                </div>
                              ))}
                              {axisTaxOfNew().map((t) => (
                                <datalist key={t.id} id={`row-${t.id}`}>
                                  {t.taxonomy_terms.map((term) => <option key={term.id} value={term.name} />)}
                                </datalist>
                              ))}
                              <button type="button" className="btn ghost sm" onClick={() => setNp({ rows: [...np.rows, EMPTY_ROW()] })}>
                                + Agregar variación
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {error && <div className="form-error">{error}</div>}
              <div className="inline-form-actions">
                <button className="btn primary lg" disabled={busy}>{busy ? 'Guardando…' : 'Guardar producto'}</button>
                <button type="button" className="btn ghost" onClick={() => setNewProd(null)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ Modal: movimiento ============ */}
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
              <label>Nota (opcional)
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

      {/* ============ Modal: agregar variación a producto existente ============ */}
      {addVar && (
        <div className="modal-backdrop" onClick={() => setAddVar(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>Nueva variación — {products.find((p) => p.id === addVar.productId)?.name}</h2>
            <form onSubmit={onSubmitAddVariant} className="vform">
              {(products.find((p) => p.id === addVar.productId)?.variant_axes || []).map((ax) => (
                <label key={ax}>{ax}
                  <input required value={addVar.values[ax] || ''}
                    onChange={(e) => setAddVar((s) => ({ ...s, values: { ...s.values, [ax]: e.target.value } }))} />
                </label>
              ))}
              <label>Stock inicial
                <input type="number" min="0" step="1" value={addVar.stock}
                  onChange={(e) => setAddVar((s) => ({ ...s, stock: e.target.value }))} placeholder="0" />
              </label>
              <label>SKU (opcional)
                <input value={addVar.sku} onChange={(e) => setAddVar((s) => ({ ...s, sku: e.target.value }))} />
              </label>
              <label>Precio (opcional, hereda del producto)
                <input type="number" min="0" step="0.01" value={addVar.price}
                  onChange={(e) => setAddVar((s) => ({ ...s, price: e.target.value }))} placeholder="hereda" />
              </label>
              <div className="inline-form-actions">
                <button className="btn primary" disabled={busy}>Crear variación</button>
                <button type="button" className="btn ghost" onClick={() => setAddVar(null)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ Modal: editar variación ============ */}
      {varEdit && (
        <div className="modal-backdrop" onClick={() => setVarEdit(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>Editar — {varEdit.productName}{varEdit.label && <span className="muted"> · {varEdit.label}</span>}</h2>
            <form onSubmit={onSubmitVarEdit} className="vform">
              <label>SKU
                <input value={varEdit.sku} onChange={(e) => setVarEdit((s) => ({ ...s, sku: e.target.value }))} placeholder="CAM-OXF-AZ-M" />
              </label>
              <label>Precio (vacío = usar el del producto)
                <input type="number" step="0.01" min="0" value={varEdit.price}
                  onChange={(e) => setVarEdit((s) => ({ ...s, price: e.target.value }))} placeholder="Hereda del producto" />
              </label>
              <label>Stock objetivo (para la alerta de stock bajo)
                <input type="number" step="0.01" min="0" value={varEdit.target}
                  onChange={(e) => setVarEdit((s) => ({ ...s, target: e.target.value }))} placeholder="Sin alerta" />
              </label>
              <p className="hint">Habrá alerta cuando el stock baje al {lowPct}% del objetivo (configurable en <Link to="/settings">Negocio → Inventario</Link>).</p>
              <div className="inline-form-actions">
                <button className="btn primary" disabled={busy}>Guardar</button>
                <button type="button" className="btn ghost" onClick={() => setVarEdit(null)}>Cancelar</button>
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
