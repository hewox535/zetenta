import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import {
  fetchProducts, deleteProduct,
  fetchMovements, createMovement,
  fetchTaxonomies,
  createProductWithVariants, updateProductDetails,
  addProductVariant, updateVariant, deleteVariant,
  transferStock,
  mediaUrl, uploadProductImage, deleteProductMedia,
} from '../lib/api';
import { money, formatDate, variantLabel } from '../lib/calc';

// Stock de una variante en una sucursal concreta (0 si no tiene fila).
const branchStock = (v, branchId) => {
  const vs = (v.variant_stock || []).find((x) => x.branch_id === branchId);
  return vs ? Number(vs.stock) : 0;
};

// ---------- Carga masiva por CSV (productos simples) ----------
function parseCSV(text, delim) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c === '\r') { /* ignora */ }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}
const PROD_ALIASES = {
  name: ['nombre', 'name', 'producto'],
  sku: ['sku', 'codigo', 'código', 'code'],
  price: ['precio', 'price', 'precio_usd', 'preciousd'],
  unit: ['unidad', 'unit', 'und'],
  stock: ['stock', 'cantidad', 'existencia', 'inicial', 'qty'],
};
const numFrom = (s) => Number(String(s ?? '').replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
function productsFromCSV(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
  const matrix = parseCSV(text, delim);
  if (!matrix.length) return [];
  const header = matrix[0].map((h) => h.trim().toLowerCase());
  const idx = {}; let hasHeader = false;
  for (const [field, aliases] of Object.entries(PROD_ALIASES)) {
    const j = header.findIndex((h) => aliases.includes(h));
    if (j >= 0) { idx[field] = j; hasHeader = true; }
  }
  const dataRows = hasHeader ? matrix.slice(1) : matrix;
  const map = hasHeader ? idx : { name: 0, sku: 1, price: 2, unit: 3, stock: 4 };
  const out = [];
  for (const r of dataRows) {
    const get = (f) => (map[f] != null ? (r[map[f]] ?? '').trim() : '');
    const name = get('name');
    if (!name) continue;
    out.push({
      name, sku: get('sku'), unit: get('unit') || 'und',
      price: numFrom(get('price')), stock: numFrom(get('stock')),
    });
  }
  return out;
}
function downloadInvTemplate() {
  const csv = 'nombre,sku,precio,unidad,stock\nCamisa Oxford,CAM-OXF,12.50,und,20\n';
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = 'inventario-plantilla.csv'; a.click();
  URL.revokeObjectURL(url);
}

const MOVE_LABELS = { in: 'Entrada', out: 'Salida', adjustment: 'Ajuste' };

const variantsOf = (p) => p.product_variants || [];
const mediaOf = (p) => (p.product_media || []).slice().sort((a, b) => a.sort_order - b.sort_order);
const productImg = (p) => { const m = mediaOf(p).find((x) => !x.variant_id) || mediaOf(p)[0]; return m ? mediaUrl(m) : null; };
const totalStock = (p) => variantsOf(p).reduce((s, v) => s + Number(v.stock || 0), 0);
const isSimple = (p) => variantsOf(p).length <= 1 && (p.variant_axes || []).length === 0;
const defaultVariant = (p) =>
  variantsOf(p).find((v) => Object.keys(v.attributes || {}).length === 0) || variantsOf(p)[0];

const newRow = () => ({ key: Math.random().toString(36).slice(2), values: {}, stock: '', sku: '', price: '' });

// Iconos limpios para acciones de la tabla.
const ICON = {
  chevron: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  edit: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>,
  trash: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M6 7l1 12a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  plus: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>,
  minus: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>,
  adjust: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 8h11M19 8h1M4 16h1M9 16h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="17" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6"/><circle cx="7" cy="16" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>,
  transfer: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  upload: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 16V5M8 9l4-4 4 4M5 19h14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

// Selector con las opciones existentes + "＋ Otro…" para escribir un valor nuevo.
function TermSelect({ terms, value, onChange, placeholder }) {
  const names = terms.map((t) => t.name);
  const [custom, setCustom] = useState(() => !!value && !names.includes(value));

  if (custom) {
    return (
      <div className="term-select">
        <input autoFocus value={value} placeholder={placeholder || 'Nuevo valor'}
          onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="term-select-back" title="Elegir de la lista"
          onClick={() => { setCustom(false); onChange(''); }}>▾</button>
      </div>
    );
  }
  return (
    <select value={names.includes(value) ? value : ''}
      onChange={(e) => { if (e.target.value === '__new__') { setCustom(true); onChange(''); } else onChange(e.target.value); }}>
      <option value="">{placeholder || 'Elegir…'}</option>
      {names.map((n) => <option key={n} value={n}>{n}</option>)}
      <option value="__new__">＋ Otro…</option>
    </select>
  );
}

export default function Inventory() {
  const { business } = useAuth();
  const { branchId, currentBranch, allBranches } = useBranch();
  const multiBranch = allBranches.length > 1;
  const [products, setProducts] = useState(null);
  const [transfer, setTransfer] = useState(null);  // { productId, variantId, label, to, quantity }
  const [importMsg, setImportMsg] = useState(null);
  const [movements, setMovements] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [taxonomies, setTaxonomies] = useState([]);
  const [filters, setFilters] = useState({});
  const [ptype, setPtype] = useState('all');   // 'all' | 'variants' | 'simple'
  const [expanded, setExpanded] = useState({});
  const [move, setMove] = useState(null);
  const [modal, setModal] = useState(null);   // modal crear/editar producto

  const catTax = taxonomies.filter((t) => t.kind !== 'variant');
  const varTax = taxonomies.filter((t) => t.kind === 'variant');
  const axisTermsByName = (name) => (varTax.find((t) => t.name === name)?.taxonomy_terms) || [];

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

  const termName = new Map();
  taxonomies.forEach((t) => t.taxonomy_terms.forEach((term) => termName.set(term.id, term.name)));

  const visibleProducts = (products || []).filter((p) => {
    if (ptype === 'variants' && isSimple(p)) return false;
    if (ptype === 'simple' && !isSimple(p)) return false;
    return Object.entries(filters).every(([, termId]) =>
      !termId || (p.product_terms || []).some((pt) => pt.term_id === termId));
  });
  const filterables = taxonomies.filter((t) => t.taxonomy_terms.length > 0);

  // ---------- Abrir modal ----------
  function openCreate() {
    setError(null);
    setModal({
      mode: 'create', name: '', price: '', sku: '', unit: 'und', categories: {},
      cmode: 'simple', simpleStock: '', axisIds: [], rows: [newRow()], stagedFiles: [],
    });
  }
  function openEdit(p) {
    setError(null);
    // Categorías y, en productos simples, propiedades (Talla, Color…): ambas
    // viven en product_terms, así que se cosechan de todas las taxonomías.
    const categories = {};
    for (const t of taxonomies) {
      const ids = new Set(t.taxonomy_terms.map((x) => x.id));
      const pt = (p.product_terms || []).find((x) => ids.has(x.term_id));
      if (pt) categories[t.id] = termName.get(pt.term_id) || '';
    }
    setModal({
      mode: 'edit', id: p.id, axes: p.variant_axes || [], simple: isSimple(p),
      name: p.name, price: String(p.price ?? ''), sku: p.sku || '', unit: p.unit || 'und',
      categories,
      variants: variantsOf(p).map((v) => ({
        id: v.id, label: variantLabel(v.attributes, p.variant_axes),
        stock: String(branchStock(v, branchId)), origStock: branchStock(v, branchId),
        sku: v.sku || '', price: v.price != null ? String(v.price) : '',
        target: v.target_stock != null ? String(v.target_stock) : '',
      })),
      newRows: [], media: mediaOf(p),
    });
  }

  // Subida/borrado de imágenes (modo edición: inmediato, el producto ya existe).
  async function onUploadImage(file, variantId = null) {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const m = await uploadProductImage(business.id, modal.id, file, {
        variantId, sortOrder: (modal.media?.length || 0),
      });
      setModal((s) => ({ ...s, media: [...(s.media || []), m] }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function onRemoveImage(m) {
    setBusy(true); setError(null);
    try {
      await deleteProductMedia(m);
      setModal((s) => ({ ...s, media: (s.media || []).filter((x) => x.id !== m.id) }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const setM = (patch) => setModal((s) => ({ ...s, ...patch }));

  // ---------- Guardar ----------
  async function onSubmit(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      // Producto simple: además de categorías, lleva propiedades de variación
      // (Talla, Color…) como dato del producto. Con variaciones, esos valores
      // van en los atributos de cada variante, no aquí.
      const simpleNow = modal.mode === 'create' ? modal.cmode === 'simple' : modal.simple;
      const categories = {};
      for (const t of [...catTax, ...(simpleNow ? varTax : [])]) {
        const val = (modal.categories[t.id] || '').trim();
        if (val) categories[t.name] = val;
      }

      if (modal.mode === 'create') {
        let variants; let variantAxes = [];
        if (modal.cmode === 'simple') {
          variants = [{ attributes: {}, stock: Number(modal.simpleStock) || 0 }];
        } else {
          const axes = varTax.filter((t) => modal.axisIds.includes(t.id));
          if (axes.length === 0) throw new Error('Elige al menos un eje de variación (Color, Talla…).');
          variantAxes = axes.map((t) => t.name);
          variants = buildVariants(modal.rows, axes.map((t) => t.name));
        }
        const created = await createProductWithVariants({
          name: modal.name.trim(), sku: modal.sku.trim(), unit: modal.unit.trim() || 'und',
          price: Number(modal.price) || 0, categories, variantAxes, variants, branchId,
        });
        for (let i = 0; i < (modal.stagedFiles || []).length; i++) {
          await uploadProductImage(business.id, created.id, modal.stagedFiles[i], { sortOrder: i });
        }
      } else {
        // EDIT
        await updateProductDetails(modal.id, {
          name: modal.name.trim(), sku: modal.sku.trim(), unit: modal.unit.trim() || 'und',
          price: Number(modal.price) || 0, categories,
        });
        for (const v of modal.variants) {
          const patch = {};
          if (v.sku !== undefined) patch.sku = v.sku.trim();
          patch.price = v.price === '' ? null : Number(v.price);
          patch.target_stock = v.target === '' ? null : Number(v.target);
          await updateVariant(v.id, patch);
          const ns = Number(v.stock) || 0;
          if (ns !== v.origStock) {
            await createMovement(business.id, { productId: modal.id, variantId: v.id, type: 'adjustment', quantity: ns, note: 'Ajuste (edición)', branchId });
          }
        }
        for (const r of modal.newRows) {
          const attributes = {};
          for (const ax of modal.axes) {
            const val = (r.values[ax] || '').trim();
            if (!val) throw new Error('Cada variación nueva debe tener todos sus valores.');
            attributes[ax] = val;
          }
          await addProductVariant(modal.id, {
            attributes, sku: r.sku.trim(), price: r.price === '' ? null : Number(r.price), stock: Number(r.stock) || 0, branchId,
          });
        }
      }
      await reload();
      setModal(null);
    } catch (err) {
      setError(err.message.includes('duplicate') || err.message.includes('unique')
        ? 'Hay una variación repetida (misma combinación).' : err.message);
    } finally { setBusy(false); }
  }

  function buildVariants(rows, axisNames) {
    const seen = new Set();
    const out = rows.map((r) => {
      const attributes = {};
      for (const name of axisNames) {
        const val = (r.values[name] || '').trim();
        if (!val) throw new Error('Cada variación debe tener todos sus valores (Color, Talla…).');
        attributes[name] = val;
      }
      const sig = axisNames.map((n) => attributes[n]).join('|');
      if (seen.has(sig)) throw new Error(`Variación repetida: ${axisNames.map((n) => attributes[n]).join(' · ')}.`);
      seen.add(sig);
      return { attributes, stock: Number(r.stock) || 0, sku: r.sku.trim(), price: r.price === '' ? null : Number(r.price) };
    });
    if (out.length === 0) throw new Error('Agrega al menos una variación.');
    return out;
  }

  // ---------- Acciones de tabla ----------
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
        quantity: Number(move.quantity), note: move.note.trim(), branchId,
      });
      await reload();
      setMove(null);
    } catch (err) {
      setError(err.message.includes('Insufficient stock') ? 'No hay stock suficiente para esa salida.' : err.message);
    } finally { setBusy(false); }
  }

  async function onImportProducts(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null); setImportMsg(null); setBusy(true);
    try {
      const text = await file.text();
      const rows = productsFromCSV(text);
      if (!rows.length) { setImportMsg('No se encontraron filas válidas en el CSV.'); return; }
      let ok = 0;
      for (const r of rows) {
        await createProductWithVariants({
          name: r.name, sku: r.sku, unit: r.unit, price: r.price, categories: {}, variantAxes: [],
          variants: [{ attributes: {}, stock: r.stock }], branchId,
        });
        ok++;
      }
      await reload();
      setImportMsg(`Importados ${ok} producto(s)${multiBranch && currentBranch ? ` a ${currentBranch.name}` : ''}.`);
    } catch (err) {
      setError(`No se pudo importar: ${err.message}`);
    } finally { setBusy(false); }
  }

  async function onSubmitTransfer(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await transferStock({ variantId: transfer.variantId, fromBranch: branchId, toBranch: transfer.to, quantity: transfer.quantity, note: 'Traslado' });
      await reload();
      setTransfer(null);
    } catch (err) {
      setError(err.message.includes('Insufficient') || err.message.includes('suficiente')
        ? 'No hay stock suficiente en la sucursal de origen.' : err.message);
    } finally { setBusy(false); }
  }

  const moveButtons = (p, v) => (
    <>
      <button className="icon-btn" title="Entrada (sumar stock)"
        onClick={() => setMove({ productId: p.id, variantId: v.id, label: variantLabel(v.attributes), type: 'in', quantity: '', note: '' })}>{ICON.plus}</button>
      <button className="icon-btn" title="Salida (restar stock)"
        onClick={() => setMove({ productId: p.id, variantId: v.id, label: variantLabel(v.attributes), type: 'out', quantity: '', note: '' })}>{ICON.minus}</button>
      <button className="icon-btn" title="Ajustar stock"
        onClick={() => setMove({ productId: p.id, variantId: v.id, label: variantLabel(v.attributes), type: 'adjustment', quantity: String(branchStock(v, branchId)), note: '' })}>{ICON.adjust}</button>
      {multiBranch && (
        <button className="icon-btn" title="Trasladar a otra sucursal"
          onClick={() => setTransfer({ productId: p.id, variantId: v.id, label: variantLabel(v.attributes, p.variant_axes) || 'Estándar', to: '', quantity: '' })}>{ICON.transfer}</button>
      )}
    </>
  );

  const axisTaxOfModal = () => varTax.filter((t) => modal.axisIds.includes(t.id));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Inventario</h1>
          <p className="page-sub">Productos, variantes y movimientos de stock.</p>
        </div>
        <div className="page-actions">
          <Link to="/inventory/history" className="btn ghost">Historial completo</Link>
          <label className="btn ghost">
            ⬆ Importar CSV
            <input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={onImportProducts} />
          </label>
          <button className="btn primary" onClick={openCreate}>+ Nuevo producto</button>
        </div>
      </header>

      {importMsg && (
        <div className="form-ok">
          {importMsg} <button className="linklike" onClick={() => setImportMsg(null)}>ok</button>
          {' · '}<button className="linklike" onClick={downloadInvTemplate}>descargar plantilla</button>
        </div>
      )}

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

      {error && !modal && <div className="form-error">{error}</div>}

      {products === null ? (
        <div className="empty">Cargando…</div>
      ) : products.length === 0 ? (
        <div className="empty">Aún no tienes productos. Usa <strong>+ Nuevo producto</strong> para agregar el primero.</div>
      ) : (
        <>
        <div className="inv-filters">
          <div className="seg sm">
            <button type="button" className={`seg-btn${ptype === 'all' ? ' active' : ''}`} onClick={() => setPtype('all')}>Todos</button>
            <button type="button" className={`seg-btn${ptype === 'variants' ? ' active' : ''}`} onClick={() => setPtype('variants')}>Con variantes</button>
            <button type="button" className={`seg-btn${ptype === 'simple' ? ' active' : ''}`} onClick={() => setPtype('simple')}>Simples</button>
          </div>
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
        {visibleProducts.length === 0 ? (
          <div className="empty">Ningún producto coincide con el filtro.</div>
        ) : (
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
                        <div className="prod-cell">
                          {simple ? (
                            <span className="tree-spacer" />
                          ) : (
                            <button className={`tree-toggle${open ? ' open' : ''}`}
                              title={open ? 'Ocultar variantes' : 'Ver variantes'}
                              onClick={() => setExpanded((s) => ({ ...s, [p.id]: !s[p.id] }))}>{ICON.chevron}</button>
                          )}
                          <span className="list-thumb">
                            {productImg(p) ? <img src={productImg(p)} alt="" loading="lazy" /> : <span className="thumb-ph">{p.name.slice(0, 1)}</span>}
                          </span>
                          <div className="prod-info">
                            <div className="prod-name">
                              {p.name}
                              {!simple && <span className="variant-count">{variantsOf(p).length} variantes</span>}
                            </div>
                            {(p.product_terms || []).length > 0 && (
                              <div className="product-tags">
                                {p.product_terms.map((pt) => termName.get(pt.term_id)).filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="mono">{p.sku}</td>
                      <td className="num">{money(p.price)}</td>
                      <td className="num">
                        <strong>{variantsOf(p).reduce((s, v) => s + branchStock(v, branchId), 0)}</strong> {p.unit}
                        {multiBranch && <div className="muted">total {totalStock(p)}</div>}
                        {simple && dv && isLow(dv) && <span className="badge low">Bajo</span>}
                        {!simple && productHasLow(p) && <span className="badge low">Bajo</span>}
                      </td>
                      <td className="row-actions">
                        {simple && dv && moveButtons(p, dv)}
                        <button className="icon-btn" title="Editar producto" onClick={() => openEdit(p)}>{ICON.edit}</button>
                        <button className="icon-btn danger" title="Eliminar producto" onClick={() => onDeleteProduct(p)}>{ICON.trash}</button>
                      </td>
                    </tr>
                    {!simple && open && variantsOf(p).map((v) => (
                      <tr key={v.id} className="variant-row">
                        <td className="variant-cell">↳ {variantLabel(v.attributes, p.variant_axes) || 'Estándar'}</td>
                        <td className="mono">{v.sku}</td>
                        <td className="num">{v.price != null ? money(v.price) : <span className="muted">{money(p.price)}</span>}</td>
                        <td className="num">
                          <strong>{branchStock(v, branchId)}</strong> {p.unit}
                          {multiBranch && <div className="muted">total {Number(v.stock)}</div>}
                          {isLow(v) && <span className="badge low">Bajo</span>}
                          {v.target_stock != null && <div className="muted">objetivo {Number(v.target_stock)}</div>}
                        </td>
                        <td className="row-actions">
                          {moveButtons(p, v)}
                          {multiBranch && (
                            <button className="icon-btn" title="Trasladar a otra sucursal"
                              onClick={() => setTransfer({ productId: p.id, variantId: v.id, label: variantLabel(v.attributes, p.variant_axes) || 'Estándar', to: '', quantity: '' })}>{ICON.transfer}</button>
                          )}
                          <button className="icon-btn danger" title="Quitar variante" onClick={() => onDeleteVariant(p, v)}>{ICON.trash}</button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
        </>
      )}

      {/* ============ Modal crear / editar producto ============ */}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal card modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{modal.mode === 'create' ? 'Nuevo producto' : 'Editar producto'}</h2>
              <button className="btn ghost sm" onClick={() => setModal(null)}>Cerrar</button>
            </div>
            <form onSubmit={onSubmit} className="vform">
              {modal.mode === 'create' && (
                <div className="mode-pills" role="radiogroup" aria-label="Tipo de producto">
                  {[
                    ['simple', 'Producto simple', 'Un solo artículo con su stock'],
                    ['variants', 'Con variaciones', 'Talla, color u otros ejes'],
                  ].map(([key, label, sub]) => (
                    <button type="button" key={key} role="radio" aria-checked={modal.cmode === key}
                      className={`mode-pill${modal.cmode === key ? ' active' : ''}`}
                      onClick={() => setM({ cmode: key })}>
                      <span className="mode-radio" aria-hidden="true" />
                      <span className="mode-pill-text">
                        <span className="mode-pill-label">{label}</span>
                        <span className="mode-pill-sub">{sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="np-grid">
                <label className="np-name">Nombre
                  <input value={modal.name} onChange={(e) => setM({ name: e.target.value })} required autoFocus placeholder="Camisa Oxford" />
                </label>
                <label>Precio (USD)
                  <input type="number" step="0.01" min="0" value={modal.price} onChange={(e) => setM({ price: e.target.value })} placeholder="0,00" />
                </label>
                <label>SKU
                  <input value={modal.sku} onChange={(e) => setM({ sku: e.target.value })} placeholder="CAM-OXF" />
                </label>
                <label>Unidad
                  <input value={modal.unit} onChange={(e) => setM({ unit: e.target.value })} placeholder="und" />
                </label>
              </div>

              {(() => {
                // Producto simple: también puede fijar Talla, Color, etc. como
                // dato del producto (sin crear variaciones); alimenta los
                // filtros del POS y del inventario igual que las categorías.
                const simpleNow = modal.mode === 'create' ? modal.cmode === 'simple' : modal.simple;
                const tagTax = [...catTax, ...(simpleNow ? varTax : [])];
                if (tagTax.length === 0) return null;
                return (
                  <div className="np-block">
                    <div className="oc-label">{simpleNow && varTax.length > 0 ? 'Categorías y propiedades' : 'Categorías'}</div>
                    <div className="np-grid">
                      {tagTax.map((t) => (
                        <label key={t.id}>{t.name}
                          <TermSelect terms={t.taxonomy_terms} value={modal.categories[t.id] || ''}
                            onChange={(val) => setM({ categories: { ...modal.categories, [t.id]: val } })}
                            placeholder={`Elegir ${t.name.toLowerCase()}…`} />
                        </label>
                      ))}
                    </div>
                    {simpleNow && varTax.length > 0 && (
                      <p className="hint">Talla, color, etc. de un producto sin variaciones. Si el producto varía por esos ejes, usa “Con variaciones”.</p>
                    )}
                  </div>
                );
              })()}

              {/* -------- Imágenes -------- */}
              <div className="np-block">
                <div className="oc-label">Imágenes del producto</div>
                <div className="img-grid">
                  {modal.mode === 'create'
                    ? (modal.stagedFiles || []).map((f, i) => (
                        <div className="img-thumb" key={i}>
                          <img src={URL.createObjectURL(f)} alt="" />
                          <button type="button" className="img-del" onClick={() => setM({ stagedFiles: modal.stagedFiles.filter((_, j) => j !== i) })}>×</button>
                        </div>
                      ))
                    : (modal.media || []).filter((m) => !m.variant_id).map((m) => (
                        <div className="img-thumb" key={m.id}>
                          <img src={mediaUrl(m)} alt="" />
                          <button type="button" className="img-del" onClick={() => onRemoveImage(m)}>×</button>
                        </div>
                      ))}
                  <label className="img-add">
                    <input type="file" accept="image/*" multiple={modal.mode === 'create'} hidden disabled={busy}
                      onChange={(e) => {
                        const files = [...e.target.files];
                        if (modal.mode === 'create') setM({ stagedFiles: [...(modal.stagedFiles || []), ...files] });
                        else if (files[0]) onUploadImage(files[0], null);
                        e.target.value = '';
                      }} />
                    <span>＋ Foto</span>
                  </label>
                </div>
              </div>

              {/* -------- Variaciones -------- */}
              {modal.mode === 'create' ? (
                <div className="np-block">
                  {modal.cmode === 'simple' ? (
                    <label className="short">Stock inicial
                      <input type="number" step="1" min="0" value={modal.simpleStock}
                        onChange={(e) => setM({ simpleStock: e.target.value })} placeholder="0" />
                    </label>
                  ) : varTax.length === 0 ? (
                    <p className="hint">No hay ejes de variación. Créalos en <Link to="/settings">Negocio → Inventario → Variaciones</Link> (p. ej. Color, Talla).</p>
                  ) : (
                    <div className="np-variants">
                      <div className="oc-label">Varía por</div>
                      <div className="variant-axis-pills">
                        {varTax.map((t) => (
                          <button type="button" key={t.id}
                            className={`pay-pill${modal.axisIds.includes(t.id) ? ' active' : ''}`}
                            onClick={() => setM({ axisIds: modal.axisIds.includes(t.id) ? modal.axisIds.filter((x) => x !== t.id) : [...modal.axisIds, t.id], rows: [newRow()] })}>
                            {t.name}
                          </button>
                        ))}
                      </div>

                      {axisTaxOfModal().length > 0 && (
                        <VarRows
                          axisNames={axisTaxOfModal().map((t) => t.name)}
                          termsFor={axisTermsByName}
                          rows={modal.rows}
                          onChange={(rows) => setM({ rows })}
                        />
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* -------- Editar: variantes existentes + agregar -------- */
                <div className="np-block">
                  <div className="oc-label">Variantes</div>
                  <div className="edit-variants">
                    <div className="edit-var-head">
                      <span className="evh-img" /><span>Variante</span><span>Stock</span><span>SKU</span><span>Precio</span><span>Objetivo</span>
                    </div>
                    {modal.variants.map((v, i) => {
                      const vm = (modal.media || []).find((m) => m.variant_id === v.id);
                      return (
                      <div className="edit-var-row" key={v.id}>
                        <label className="var-img" title="Imagen de la variación">
                          {vm ? <img src={mediaUrl(vm)} alt="" /> : <span className="thumb-ph">＋</span>}
                          <input type="file" accept="image/*" hidden disabled={busy}
                            onChange={async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (vm) await onRemoveImage(vm); await onUploadImage(f, v.id); }} />
                        </label>
                        <span className="edit-var-label">{v.label || 'Estándar'}</span>
                        <input type="number" min="0" step="1" value={v.stock}
                          onChange={(e) => setM({ variants: modal.variants.map((x, j) => j === i ? { ...x, stock: e.target.value } : x) })} />
                        <input value={v.sku} placeholder="—"
                          onChange={(e) => setM({ variants: modal.variants.map((x, j) => j === i ? { ...x, sku: e.target.value } : x) })} />
                        <input type="number" min="0" step="0.01" value={v.price} placeholder="hereda"
                          onChange={(e) => setM({ variants: modal.variants.map((x, j) => j === i ? { ...x, price: e.target.value } : x) })} />
                        <input type="number" min="0" step="1" value={v.target} placeholder="—"
                          onChange={(e) => setM({ variants: modal.variants.map((x, j) => j === i ? { ...x, target: e.target.value } : x) })} />
                      </div>
                    ); })}
                  </div>
                  <p className="hint">Cambiar el stock aquí registra un ajuste de inventario. Para separar entradas y salidas usa los botones de la tabla.</p>

                  {modal.axes.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div className="oc-label">Agregar variaciones</div>
                      <VarRows
                        axisNames={modal.axes}
                        termsFor={axisTermsByName}
                        rows={modal.newRows}
                        emptyHint="Usa “+ Agregar variación” para sumar combinaciones nuevas."
                        onChange={(newRows) => setM({ newRows })}
                      />
                    </div>
                  )}
                </div>
              )}

              {error && <div className="form-error">{error}</div>}
              <div className="inline-form-actions">
                <button className="btn primary lg" disabled={busy}>{busy ? 'Guardando…' : 'Guardar producto'}</button>
                <button type="button" className="btn ghost" onClick={() => setModal(null)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ Modal movimiento ============ */}
      {move && (
        <div className="modal-backdrop" onClick={() => setMove(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>
              {MOVE_LABELS[move.type]} — {products.find((p) => p.id === move.productId)?.name}
              {move.label && <span className="muted"> · {move.label}</span>}
            </h2>
            <form onSubmit={onSubmitMove} className="vform">
              {multiBranch && currentBranch && <p className="hint">Sucursal: <strong>{currentBranch.name}</strong></p>}
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

      {/* ============ Modal de traslado entre sucursales ============ */}
      {transfer && (
        <div className="modal-backdrop" onClick={() => setTransfer(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>
              Trasladar — {products.find((p) => p.id === transfer.productId)?.name}
              {transfer.label && <span className="muted"> · {transfer.label}</span>}
            </h2>
            <form onSubmit={onSubmitTransfer} className="vform">
              <p className="hint">Desde <strong>{currentBranch?.name}</strong> hacia otra sucursal.</p>
              <label>Sucursal destino
                <select value={transfer.to} onChange={(e) => setTransfer((m) => ({ ...m, to: e.target.value }))} required>
                  <option value="">Elegir…</option>
                  {allBranches.filter((b) => b.id !== branchId).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
              <label>Cantidad a trasladar
                <input type="number" step="0.01" min="0.01" autoFocus required value={transfer.quantity}
                  onChange={(e) => setTransfer((m) => ({ ...m, quantity: e.target.value }))} />
              </label>
              <div className="inline-form-actions">
                <button className="btn primary" disabled={busy || !transfer.to}>Trasladar</button>
                <button type="button" className="btn ghost" onClick={() => setTransfer(null)}>Cancelar</button>
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

// Constructor de variaciones: una fila por combinación, con selectores por eje.
// Cada variación es una tarjeta con borde suave y cada campo lleva su propio
// label (legible también en móvil, donde los campos se apilan).
function VarRows({ axisNames, termsFor, rows, onChange, emptyHint }) {
  const update = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setValue = (i, name, val) => onChange(rows.map((r, j) => (j === i ? { ...r, values: { ...r.values, [name]: val } } : r)));
  return (
    <div className="var-rows">
      {rows.length === 0 && emptyHint && <p className="hint">{emptyHint}</p>}
      {rows.map((r, i) => (
        <div className="var-card" key={r.key}>
          <div className="var-card-fields">
            {axisNames.map((name) => (
              <label className="var-field" key={name}>{name}
                <TermSelect terms={termsFor(name)} value={r.values[name] || ''}
                  onChange={(val) => setValue(i, name, val)} placeholder={name} />
              </label>
            ))}
            <label className="var-field num">Stock
              <input type="number" min="0" step="1" value={r.stock} placeholder="0"
                onChange={(e) => update(i, { stock: e.target.value })} />
            </label>
            <label className="var-field">SKU
              <input value={r.sku} placeholder="opcional" onChange={(e) => update(i, { sku: e.target.value })} />
            </label>
            <label className="var-field num">Precio
              <input type="number" min="0" step="0.01" value={r.price} placeholder="hereda"
                onChange={(e) => update(i, { price: e.target.value })} />
            </label>
          </div>
          <button type="button" className="var-row-del" aria-label="Quitar variación" title="Quitar variación"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={() => onChange([...rows, newRow()])}>
        + Agregar variación
      </button>
    </div>
  );
}
