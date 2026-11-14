import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import {
  fetchProducts, deleteProduct,
  createMovement,
  fetchTaxonomies,
  createProductWithVariants, updateProductDetails,
  addProductVariant, updateVariant, deleteVariant,
  transferStock, setProductsOffer,
  mediaUrl, uploadProductImage, deleteProductMedia,
  fetchProductVariants, createTaxonomy, findOrCreateTerm, updateProduct,
} from '../lib/api';
import { money, variantLabel, offerPrice, hasOffer, offerTag } from '../lib/calc';
import { useConfirm } from '../components/Confirm';
import { RowMenu, SortHead } from '../components/FinUI';
import './finance.css';
import './inventory.css';
import { VariationDialog, emptyVariations, sigOf, labelOf, skuFor } from '../components/VariantBuilder';
import { GenerateDialog, VariantTable } from '../components/VariantTable';

const newKey = () => Math.random().toString(36).slice(2);

// Stock de una variante en una sucursal concreta (0 si no tiene fila).
const branchStock = (v, branchId) => {
  const vs = (v.variant_stock || []).find((x) => x.branch_id === branchId);
  return vs ? Number(vs.stock) : 0;
};

// ---------- Carga masiva por CSV (simples o con variaciones) ----------
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
  cost: ['costo', 'cost', 'precio_compra', 'compra'],
  unit: ['unidad', 'unit', 'und'],
  stock: ['stock', 'cantidad', 'existencia', 'inicial', 'qty'],
};
const numFrom = (s) => Number(String(s ?? '').replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
const normHeader = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// axisNames: ejes de variación del negocio (Talla, Color…). Un encabezado que
// coincida con un eje se lee como atributo de variación de la fila.
function productsFromCSV(text, axisNames = []) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
  const matrix = parseCSV(text, delim);
  if (!matrix.length) return [];
  const header = matrix[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  for (const [field, aliases] of Object.entries(PROD_ALIASES)) {
    const j = header.findIndex((h) => aliases.includes(h));
    if (j >= 0) idx[field] = j;
  }
  const axisIdx = {}; // nombre del eje (tal como está en la taxonomía) → columna
  header.forEach((h, j) => {
    const ax = axisNames.find((a) => normHeader(a) === normHeader(h));
    if (ax && axisIdx[ax] == null) axisIdx[ax] = j;
  });
  // Un encabezado real trae la columna del nombre (o de un eje); si no, la
  // primera fila es data (evita que un valor como "und" se lea como encabezado).
  const hasHeader = idx.name != null || Object.keys(axisIdx).length > 0;
  const dataRows = hasHeader ? matrix.slice(1) : matrix;
  const map = hasHeader ? idx : { name: 0, sku: 1, price: 2, unit: 3, stock: 4 };
  const out = [];
  for (const r of dataRows) {
    const get = (f) => (map[f] != null ? (r[map[f]] ?? '').trim() : '');
    const name = get('name');
    if (!name) continue;
    const attrs = {};
    for (const [ax, j] of Object.entries(axisIdx)) {
      const v = (r[j] ?? '').trim();
      if (v) attrs[ax] = v;
    }
    out.push({
      name, sku: get('sku'), unit: get('unit') || 'und',
      price: numFrom(get('price')), cost: numFrom(get('cost')),
      stock: numFrom(get('stock')), attrs,
    });
  }
  return out;
}
function downloadInvTemplate(axisNames = []) {
  const axes = axisNames.map((n) => n.toLowerCase());
  const header = ['nombre', 'sku', 'precio', 'costo', 'unidad', 'stock', ...axes].join(',');
  const pad = (vals) => axes.map((_, i) => vals[i] || '').join(',');
  const rows = axes.length
    ? [
        `Camisa Oxford,CAM-OXF-M,12.50,7.00,und,10,${pad(['M', 'Azul'])}`,
        `Camisa Oxford,CAM-OXF-L,12.50,7.00,und,8,${pad(['L', 'Azul'])}`,
        `Correa de cuero,ACC-01,9,4.50,und,15,${pad([])}`,
      ]
    : ['Camisa Oxford,CAM-OXF,12.50,7.00,und,20'];
  const csv = `${header}\n${rows.join('\n')}\n`;
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = 'inventario-plantilla.csv'; a.click();
  URL.revokeObjectURL(url);
}

const MOVE_LABELS = { in: 'Entrada', out: 'Salida', adjustment: 'Ajuste' };
const STOCK_FILTERS = [['all', 'Todas'], ['in', 'Con stock'], ['low', 'Stock bajo'], ['out', 'Sin stock']];

const variantsOf = (p) => p.product_variants || [];
const mediaOf = (p) => (p.product_media || []).slice().sort((a, b) => a.sort_order - b.sort_order);
const productImg = (p) => { const m = mediaOf(p).find((x) => !x.variant_id) || mediaOf(p)[0]; return m ? mediaUrl(m) : null; };
const totalStock = (p) => variantsOf(p).reduce((s, v) => s + Number(v.stock || 0), 0);
const isSimple = (p) => variantsOf(p).length <= 1 && (p.variant_axes || []).length === 0;
const defaultVariant = (p) =>
  variantsOf(p).find((v) => Object.keys(v.attributes || {}).length === 0) || variantsOf(p)[0];

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
  dots: <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="5" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="19" r="1.7" fill="currentColor"/></svg>,
};

// Selector con las opciones existentes + "＋ Otro…" para escribir un valor nuevo.
function TermSelect({ terms, value, onChange, placeholder, disabled }) {
  const names = terms.map((t) => t.name);
  const [custom, setCustom] = useState(() => !!value && !names.includes(value));

  if (custom) {
    return (
      <div className="term-select">
        <input autoFocus value={value} placeholder={placeholder || 'Nuevo valor'} disabled={disabled}
          onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="term-select-back" title="Elegir de la lista" disabled={disabled}
          onClick={() => { setCustom(false); onChange(''); }}>▾</button>
      </div>
    );
  }
  return (
    <select value={names.includes(value) ? value : ''} disabled={disabled}
      onChange={(e) => { if (e.target.value === '__new__') { setCustom(true); onChange(''); } else onChange(e.target.value); }}>
      <option value="">{placeholder || 'Elegir…'}</option>
      {names.map((n) => <option key={n} value={n}>{n}</option>)}
      <option value="__new__">＋ Otro…</option>
    </select>
  );
}

export default function Inventory() {
  const ask = useConfirm();
  const { business, canInventory } = useAuth();
  // Qué puede hacer este usuario en el inventario (el admin, todo). El
  // servidor aplica las mismas reglas; aquí solo se ocultan o bloquean controles.
  const canInfo = canInventory('inv_edit_info');
  const canMedia = canInventory('inv_edit_media');
  const canPrice = canInventory('inv_edit_price');
  const canStock = canInventory('inv_edit_stock');
  const canCreate = canInventory('inv_create');
  const canDelete = canInventory('inv_delete');
  const canEdit = canInfo || canMedia || canPrice || canStock;
  const { branchId, currentBranch, allBranches } = useBranch();
  const multiBranch = allBranches.length > 1;
  const [products, setProducts] = useState(null);
  const [transfer, setTransfer] = useState(null);  // { productId, variantId, label, to, quantity }
  const [importMsg, setImportMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [taxonomies, setTaxonomies] = useState([]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});
  const [ptype, setPtype] = useState('all');   // 'all' | 'variants' | 'simple'
  const [expanded, setExpanded] = useState({});
  const [move, setMove] = useState(null);
  const [modal, setModal] = useState(null);   // modal crear/editar producto
  const [viewer, setViewer] = useState(null); // visor de fotos: { p, i } (índice en mediaOf(p))
  const [editVar, setEditVar] = useState(null);   // variación existente que se está editando
  const [genVar, setGenVar] = useState(null);     // modal "Agregar variaciones": ejes al abrirlo (para deshacer)
  const [photo, setPhoto] = useState(null);       // foto del modal abierta en grande

  // Ofertas: filtro "En oferta" y modo selección para aplicar/quitar en lote
  // un % de descuento o un precio fijo.
  const [offerOnly, setOfferOnly] = useState(false);
  const [offerMode, setOfferMode] = useState(false);
  const [offerSel, setOfferSel] = useState(new Set());
  const [offerPct, setOfferPct] = useState('');
  const [offerKind, setOfferKind] = useState('percent'); // 'percent' | 'price'

  // Filtros agrupados en un botón, orden de la tabla e importación.
  const [filterOpen, setFilterOpen] = useState(false);
  const [stockFilter, setStockFilter] = useState('all');  // 'all' | 'in' | 'low' | 'out'
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const filterRef = useRef(null);
  const importRef = useRef(null);
  useEffect(() => {
    if (!filterOpen) return undefined;
    const close = (e) => { if (!filterRef.current?.contains(e.target)) setFilterOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setFilterOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [filterOpen]);

  const toggleOfferSel = (id) => setOfferSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  function exitOfferMode() { setOfferMode(false); setOfferSel(new Set()); setOfferPct(''); setOfferKind('percent'); }
  async function applyOffer(offer) {
    setBusy(true); setError(null);
    try {
      await setProductsOffer([...offerSel], offer);
      await reload();
      exitOfferMode();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  function openViewer(p) {
    const media = mediaOf(p);
    if (media.length === 0) return;
    const main = media.find((x) => !x.variant_id) || media[0];
    setViewer({ p, i: media.indexOf(main) });
  }

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
    const [p, t] = await Promise.all([fetchProducts(), fetchTaxonomies()]);
    setProducts(p); setTaxonomies(t);
    return p;
  }

  // Tras un movimiento hecho desde el modal de edición, las cantidades que
  // muestra el modal quedarían viejas: se releen del producto recargado (y se
  // fija origStock para no registrar un ajuste de más al guardar).
  function syncModalStock(products) {
    setModal((m) => {
      if (!m || m.mode !== 'edit') return m;
      const p = (products || []).find((x) => x.id === m.id);
      if (!p) return m;
      return {
        ...m,
        variants: m.variants.map((v) => {
          const fresh = variantsOf(p).find((x) => x.id === v.id);
          if (!fresh) return v;
          const st = branchStock(fresh, branchId);
          return { ...v, stock: String(st), origStock: st };
        }),
      };
    });
  }
  useEffect(() => { reload().catch((e) => setError(e.message)); }, []);

  const termName = new Map();
  taxonomies.forEach((t) => t.taxonomy_terms.forEach((term) => termName.set(term.id, term.name)));

  // Búsqueda sin acentos sobre nombre, SKUs (producto y variantes), valores de
  // variación (Azul, M…) y etiquetas de categoría.
  const q = normHeader(search);
  const matchesSearch = (p) => !q || [
    p.name, p.sku, p.note,
    ...variantsOf(p).flatMap((v) => [v.sku, ...Object.values(v.attributes || {})]),
    ...(p.product_terms || []).map((pt) => termName.get(pt.term_id)),
  ].some((s) => s && normHeader(s).includes(q));

  const visibleProducts = (products || []).filter((p) => {
    if (ptype === 'variants' && isSimple(p)) return false;
    if (ptype === 'simple' && !isSimple(p)) return false;
    if (offerOnly && !hasOffer(p)) return false;
    if (stockFilter !== 'all') {
      const n = variantsOf(p).reduce((acc, v) => acc + branchStock(v, branchId), 0);
      if (stockFilter === 'in' && n <= 0) return false;
      if (stockFilter === 'out' && n > 0) return false;
      if (stockFilter === 'low' && !productHasLow(p)) return false;
    }
    if (!matchesSearch(p)) return false;
    return Object.entries(filters).every(([, termId]) =>
      !termId || (p.product_terms || []).some((pt) => pt.term_id === termId));
  });
  const filterables = taxonomies.filter((t) => t.taxonomy_terms.length > 0);

  // ---------- Abrir modal ----------
  function openCreate() {
    setError(null);
    setModal({
      mode: 'create', name: '', price: '', cost: '', sku: '', unit: 'und', note: '', categories: {},
      simpleStock: '', axisIds: [], vb: emptyVariations(), stagedFiles: [],
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
      mode: 'edit', id: p.id, orig: p, axes: p.variant_axes || [], origAxes: p.variant_axes || [],
      simple: isSimple(p),
      name: p.name, price: String(p.price ?? ''), cost: p.cost != null && Number(p.cost) !== 0 ? String(p.cost) : '',
      sku: p.sku || '', unit: p.unit || 'und', note: p.note || '',
      categories,
      variants: variantsOf(p).map((v) => ({
        id: v.id, label: variantLabel(v.attributes, p.variant_axes),
        attributes: v.attributes || {}, origAttributes: v.attributes || {},
        stock: String(branchStock(v, branchId)), origStock: branchStock(v, branchId),
        sku: v.sku || '', price: v.price != null ? String(v.price) : '',
        cost: v.cost != null ? String(v.cost) : '',
        target: v.target_stock != null ? String(v.target_stock) : '',
      })),
      vbNew: emptyVariations(), media: mediaOf(p),
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
    const createdKeys = new Set(); // variaciones nuevas que ya quedaron guardadas
    try {
      // Producto simple: además de categorías, lleva propiedades de variación
      // (Talla, Color…) como dato del producto. Con variaciones, esos valores
      // van en los atributos de cada variante, no aquí.
      const simpleNow = modal.mode === 'create' ? modal.vb.length === 0 : modal.axes.length === 0;
      const categories = {};
      for (const t of [...catTax, ...(simpleNow ? varTax : [])]) {
        const val = (modal.categories[t.id] || '').trim();
        if (val) categories[t.name] = val;
      }

      if (modal.mode === 'create') {
        let variants; let variantAxes = [];
        let built = [];
        if (modal.vb.length === 0) {
          variants = [{ attributes: {}, stock: Number(modal.simpleStock) || 0 }];
        } else {
          const axes = varTax.filter((t) => modal.axisIds.includes(t.id));
          if (axes.length === 0) throw new Error('Elige en qué varía el producto (talla, color…).');
          variantAxes = axes.map((t) => t.name);
          built = modal.vb;
          const incompletas = built.filter((v) => variantAxes.some((a) => !v.attributes?.[a]));
          if (incompletas.length) {
            throw new Error(`Completa ${variantAxes.filter((a) => incompletas.some((v) => !v.attributes?.[a])).join(' y ').toLowerCase()} en ${incompletas.length === 1 ? 'una variación' : `${incompletas.length} variaciones`}.`);
          }
          const sigs = new Set();
          for (const v of built) {
            const sig = sigOf(variantAxes, v.attributes);
            if (sigs.has(sig)) throw new Error(`La variación ${labelOf(variantAxes, v.attributes)} está repetida.`);
            sigs.add(sig);
          }
          variants = built.map((v) => ({
            attributes: v.attributes, stock: Number(v.stock) || 0, sku: (v.sku || '').trim(),
            price: v.price === '' || v.price == null ? null : Number(v.price),
            cost: v.cost === '' || v.cost == null ? null : Number(v.cost),
          }));
        }
        const created = await createProductWithVariants({
          name: modal.name.trim(), sku: modal.sku.trim(), unit: modal.unit.trim() || 'und',
          price: Number(modal.price) || 0, cost: Number(modal.cost) || 0, note: modal.note.trim(),
          categories, variantAxes, variants, branchId,
        });
        for (let i = 0; i < (modal.stagedFiles || []).length; i++) {
          await uploadProductImage(business.id, created.id, modal.stagedFiles[i], { sortOrder: i });
        }
        // Fotos por variación: el RPC devuelve el producto, así que buscamos
        // las variantes creadas y las emparejamos por su combinación.
        const withPhoto = built.filter((v) => v.file);
        if (withPhoto.length) {
          const saved = await fetchProductVariants(created.id);
          const byySig = new Map(saved.map((v) => [sigOf(variantAxes, v.attributes || {}), v.id]));
          for (const v of withPhoto) {
            const variantId = byySig.get(sigOf(variantAxes, v.attributes));
            if (variantId) await uploadProductImage(business.id, created.id, v.file, { variantId });
          }
        }
      } else {
        // EDIT: solo se envía lo que el usuario puede cambiar; lo demás va
        // con el valor original para que el servidor no lo vea como cambio.
        const o = modal.orig;
        // Si se sumó un eje, las variaciones de antes necesitan su valor.
        const sinValor = modal.variants.filter((v) => modal.axes.some((ax) => !v.attributes?.[ax]));
        if (sinValor.length > 0) {
          const faltan = modal.axes.filter((ax) => sinValor.some((v) => !v.attributes?.[ax]));
          throw new Error(
            `Completa ${faltan.join(' y ').toLowerCase()} en ${sinValor.length === 1 ? 'una variación' : `${sinValor.length} variaciones`} (en la tabla de variaciones).`,
          );
        }
        if (canInfo && modal.axes.join('|') !== modal.origAxes.join('|')) {
          await updateProduct(modal.id, { variant_axes: modal.axes });
        }
        if (canInfo || canPrice) {
          await updateProductDetails(modal.id, {
            name: canInfo ? modal.name.trim() : o.name,
            sku: canInfo ? modal.sku.trim() : o.sku,
            unit: canInfo ? modal.unit.trim() || 'und' : o.unit,
            note: canInfo ? modal.note.trim() : o.note,
            price: canPrice ? Number(modal.price) || 0 : o.price,
            cost: canPrice ? Number(modal.cost) || 0 : o.cost,
            categories,
          });
        }
        for (const v of modal.variants) {
          const patch = {};
          if (canInfo) {
            patch.sku = v.sku.trim();
            if (JSON.stringify(v.attributes) !== JSON.stringify(v.origAttributes)) {
              patch.attributes = v.attributes;
            }
          }
          if (canPrice) {
            patch.price = v.price === '' ? null : Number(v.price);
            patch.cost = v.cost === '' ? null : Number(v.cost);
          }
          if (canStock) patch.target_stock = v.target === '' ? null : Number(v.target);
          if (patch.attributes) {
            for (const [ax, val] of Object.entries(patch.attributes)) await seedTerm(ax, val);
          }
          if (Object.keys(patch).length) await updateVariant(v.id, patch);
          const ns = Number(v.stock) || 0;
          if (canStock && ns !== v.origStock) {
            await createMovement(business.id, { productId: modal.id, variantId: v.id, type: 'adjustment', quantity: ns, note: 'Ajuste (edición)', branchId });
          }
        }
        if (canCreate) {
          // Antes de tocar la base: una variación nueva no puede repetir la
          // combinación de otra (ni de las que ya tiene el producto).
          const seen = new Set(modal.variants.map((v) => sigOf(modal.axes, v.attributes)));
          for (const r of modal.vbNew) {
            const sig = sigOf(modal.axes, r.attributes);
            if (seen.has(sig)) {
              throw new Error(`La variación ${labelOf(modal.axes, r.attributes) || 'estándar'} está repetida: ya hay otra con esa misma combinación.`);
            }
            seen.add(sig);
          }
          for (const r of modal.vbNew) {
            const created = await addProductVariant(modal.id, {
              attributes: r.attributes, sku: (r.sku || '').trim(),
              price: r.price === '' || r.price == null ? null : Number(r.price),
              cost: r.cost === '' || r.cost == null ? null : Number(r.cost),
              stock: Number(r.stock) || 0, branchId,
            });
            createdKeys.add(r.key);
            if (r.file && created?.id) {
              await uploadProductImage(business.id, modal.id, r.file, { variantId: created.id });
            }
          }
        }
      }
      await reload();
      setModal(null);
    } catch (err) {
      // Si alguna variación nueva alcanzó a guardarse antes del error, el modal
      // se recarga con ella ya como existente y deja en "nuevas" solo las que
      // faltan; si no, reintentar la crearía otra vez y la base la rechazaría.
      if (modal.mode === 'edit' && createdKeys.size) {
        const fresh = (await reload().catch(() => [])).find((x) => x.id === modal.id);
        if (fresh) {
          openEdit(fresh);
          setModal((m) => ({ ...m, vbNew: modal.vbNew.filter((r) => !createdKeys.has(r.key)) }));
        }
      }
      setError(err.message.includes('product_variants_product_id_attributes_key')
        ? 'Hay una variación repetida (misma combinación).' : err.message);
    } finally { setBusy(false); }
  }

  // ---------- Acciones de tabla ----------
  async function onDeleteProduct(p) {
    if (!await ask({ title: `¿Eliminar ${p.name}?`, message: 'Se eliminan también sus variantes y su historial de movimientos.', confirmLabel: 'Eliminar producto' })) return;
    try { await deleteProduct(p.id); await reload(); } catch (e) { setError(e.message); }
  }
  async function onDeleteVariant(p, v) {
    if (variantsOf(p).length <= 1) { setError('Un producto debe tener al menos una variante.'); return; }
    if (!await ask({ title: `¿Eliminar la variación ${variantLabel(v.attributes) || 'estándar'}?`, message: `Se quita de ${p.name} junto con su stock.`, confirmLabel: 'Eliminar variación' })) return;
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
      syncModalStock(await reload());
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
      const rows = productsFromCSV(text, varTax.map((t) => t.name));
      if (!rows.length) { setImportMsg('No se encontraron filas válidas en el CSV.'); return; }

      // Filas con el mismo nombre se agrupan en un producto; si traen columnas
      // de variación (Talla, Color…) cada fila es una variante. Combos
      // repetidos suman stock en vez de fallar por duplicado.
      const groups = new Map();
      for (const r of rows) {
        const key = r.name.toLowerCase();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }

      let prods = 0; let vars = 0;
      for (const group of groups.values()) {
        const base = group[0];
        const axes = varTax.map((t) => t.name)
          .filter((ax) => group.some((r) => r.attrs[ax]));
        if (axes.length === 0) {
          await createProductWithVariants({
            name: base.name, sku: base.sku, unit: base.unit, price: base.price, cost: base.cost,
            categories: {}, variantAxes: [],
            variants: [{ attributes: {}, stock: group.reduce((s, r) => s + r.stock, 0) }], branchId,
          });
        } else {
          const byCombo = new Map();
          for (const r of group) {
            const attributes = {};
            for (const ax of axes) if (r.attrs[ax]) attributes[ax] = r.attrs[ax];
            const ck = JSON.stringify(axes.map((ax) => attributes[ax] || ''));
            if (byCombo.has(ck)) byCombo.get(ck).stock += r.stock;
            else byCombo.set(ck, {
              attributes, sku: r.sku, stock: r.stock,
              price: r.price && r.price !== base.price ? r.price : null,
              cost: r.cost && r.cost !== base.cost ? r.cost : null,
            });
          }
          const variants = [...byCombo.values()];
          await createProductWithVariants({
            name: base.name, sku: '', unit: base.unit, price: base.price, cost: base.cost,
            categories: {}, variantAxes: axes, variants, branchId,
          });
          vars += variants.length;
        }
        prods++;
      }
      await reload();
      setImportMsg(`Importados ${prods} producto(s)${vars ? ` (${vars} variante(s))` : ''}${multiBranch && currentBranch ? ` a ${currentBranch.name}` : ''}.`);
    } catch (err) {
      setError(`No se pudo importar: ${err.message}`);
    } finally { setBusy(false); }
  }

  async function onSubmitTransfer(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await transferStock({ variantId: transfer.variantId, fromBranch: branchId, toBranch: transfer.to, quantity: transfer.quantity, note: 'Traslado' });
      syncModalStock(await reload());
      setTransfer(null);
    } catch (err) {
      setError(err.message.includes('Insufficient') || err.message.includes('suficiente')
        ? 'No hay stock suficiente en la sucursal de origen.' : err.message);
    } finally { setBusy(false); }
  }

  // Entrada / salida / traslado de una variación, dentro del modal de edición.
  // (El ajuste es el propio campo Cantidad de la tarjeta.)
  const stockButtons = (v) => canStock && (
    <div className="vb-moves">
      <button type="button" className="btn ghost sm" title="Registrar una entrada, con su nota"
        onClick={() => setMove({ productId: modal.id, variantId: v.id, label: v.label, type: 'in', quantity: '', note: '' })}>
        {ICON.plus} Entrada
      </button>
      <button type="button" className="btn ghost sm" title="Registrar una salida, con su nota"
        onClick={() => setMove({ productId: modal.id, variantId: v.id, label: v.label, type: 'out', quantity: '', note: '' })}>
        {ICON.minus} Salida
      </button>
      {multiBranch && (
        <button type="button" className="btn ghost sm" title="Trasladar a otra sucursal"
          onClick={() => setTransfer({ productId: modal.id, variantId: v.id, label: v.label || 'Estándar', to: '', quantity: '' })}>
          {ICON.transfer} Trasladar
        </button>
      )}
    </div>
  );

  const axisTaxOfModal = () => varTax.filter((t) => modal.axisIds.includes(t.id));

  // Valor que no está en la lista del eje (un color escrito a mano): queda
  // guardado para que aparezca en los desplegables de ahí en adelante.
  async function seedTerm(axis, value) {
    const tax = typeof axis === 'string' ? varTax.find((t) => t.name === axis) : axis;
    if (!tax || !value) return;
    if ((tax.taxonomy_terms || []).some((t) => t.name === value)) return;
    await findOrCreateTerm(tax.id, value);
  }

  // Marcar o desmarcar un eje desde el submodal: manda la casilla, sin pasos
  // intermedios. Solo cambia el estado del modal; se persiste al guardar.
  async function onToggleAxis(name, on) {
    const axisName = name.trim();
    if (!axisName) return;
    let tax = varTax.find((t) => t.name.toLowerCase() === axisName.toLowerCase());
    if (on && !tax) {
      tax = await createTaxonomy(business.id, axisName, 'variant');
      setTaxonomies(await fetchTaxonomies());
    }
    const axis = tax ? tax.name : axisName;
    const without = (attrs) => {
      const rest = { ...(attrs || {}) };
      delete rest[axis];
      return rest;
    };

    setModal((m) => {
      if (m.mode === 'create') {
        return {
          ...m,
          axisIds: on
            ? (m.axisIds.includes(tax.id) ? m.axisIds : [...m.axisIds, tax.id])
            : m.axisIds.filter((x) => x !== tax?.id),
          vb: on ? m.vb : m.vb.map((r) => ({ ...r, attributes: without(r.attributes) })),
        };
      }
      return {
        ...m,
        axes: on ? (m.axes.includes(axis) ? m.axes : [...m.axes, axis]) : m.axes.filter((x) => x !== axis),
        vbNew: on ? m.vbNew : m.vbNew.map((r) => ({ ...r, attributes: without(r.attributes) })),
        variants: on ? m.variants : m.variants.map((v) => ({ ...v, attributes: without(v.attributes) })),
      };
    });
  }

  // Modal en edición: cada grupo de campos depende de su permiso. Al crear
  // (inv_create) se llenan todos los datos iniciales.
  const editing = modal?.mode === 'edit';
  const lockInfo = editing && !canInfo;
  const lockPrice = editing && !canPrice;
  const lockStock = editing && !canStock;
  const lockMedia = editing && !canMedia;

  // ---------- Variaciones en el modal (tabla + "Agregar variaciones") ----------
  // Al crear, las filas son modal.vb. Al editar, las que ya existen
  // (modal.variants) más las nuevas (modal.vbNew). Un producto simple ya
  // guardado no muestra filas: su cantidad va en su propio bloque.
  const simpleEdit = modal?.mode === 'edit' && modal.axes.length === 0 && modal.variants.length <= 1;
  const varAxes = !modal ? [] : modal.mode === 'create' ? axisTaxOfModal().map((t) => t.name) : modal.axes;
  const varRows = !modal ? [] : modal.mode === 'create'
    ? modal.vb.map((r) => ({ ...r, isNew: true }))
    : simpleEdit ? [] : [
      ...modal.variants.map((v) => ({ ...v, key: v.id, isNew: false })),
      ...modal.vbNew.map((r) => ({ ...r, isNew: true })),
    ];
  const canAddVar = modal?.mode === 'create' || (canCreate && (canInfo || modal?.axes.length > 0));
  const colorAxisOf = (axes) => axes.find((a) => /^colou?r$/i.test(a.trim())) || null;

  function openGen() {
    setGenVar({ axisIds: modal.axisIds, axes: modal.axes });
  }
  // Cerrar sin crear: se deshacen los ejes marcados en el modal.
  function closeGen() {
    if (genVar) setModal((m) => (m.mode === 'create' ? { ...m, axisIds: genVar.axisIds } : { ...m, axes: genVar.axes }));
    setGenVar(null);
  }
  function onGenerateVariants(list, data = {}) {
    const many = list.length > 1;
    const sku = (data.sku || '').trim();
    const blank = (attributes) => ({
      key: newKey(), attributes,
      stock: data.stock ?? '', price: data.price ?? '', cost: data.cost ?? '',
      sku: sku ? (many ? skuFor(sku, Object.keys(attributes), attributes) : sku) : '',
      file: data.file || null,
    });
    setModal((m) => {
      if (m.mode === 'create') return { ...m, vb: [...m.vb, ...list.map(blank)] };
      // Producto simple que pasa a tener variaciones: la variante que ya existe
      // toma la primera combinación (conserva su stock e historial).
      const converting = m.origAxes.length === 0 && m.variants.length === 1
        && Object.keys(m.variants[0].attributes || {}).length === 0;
      if (converting) {
        const [first, ...rest] = list;
        // Conserva su stock; toma precio/costo/foto si se escribieron.
        const keep = m.variants[0];
        const b = blank(first);
        return {
          ...m,
          variants: [{
            ...keep, attributes: first,
            price: data.price !== '' && data.price != null ? data.price : keep.price,
            cost: data.cost !== '' && data.cost != null ? data.cost : keep.cost,
            sku: b.sku || keep.sku,
          }],
          vbNew: [...m.vbNew, ...rest.map(blank)],
        };
      }
      return { ...m, vbNew: [...m.vbNew, ...list.map(blank)] };
    });
    setGenVar(null);
  }
  function patchVarRow(key, patch) {
    setModal((m) => {
      if (m.mode === 'create') return { ...m, vb: m.vb.map((r) => (r.key === key ? { ...r, ...patch } : r)) };
      return {
        ...m,
        variants: m.variants.map((v) => (v.id === key ? { ...v, ...patch } : v)),
        vbNew: m.vbNew.map((r) => (r.key === key ? { ...r, ...patch } : r)),
      };
    });
  }
  function bulkVarRows(patch) {
    const p = { ...patch };
    if (lockStock) delete p.stock;
    if (lockPrice) { delete p.price; delete p.cost; }
    setModal((m) => (m.mode === 'create'
      ? { ...m, vb: m.vb.map((r) => ({ ...r, ...p })) }
      : { ...m, variants: m.variants.map((v) => ({ ...v, ...p })), vbNew: m.vbNew.map((r) => ({ ...r, ...p })) }));
  }
  function removeVarRow(row) {
    setModal((m) => (m.mode === 'create'
      ? { ...m, vb: m.vb.filter((r) => r.key !== row.key) }
      : { ...m, vbNew: m.vbNew.filter((r) => r.key !== row.key) }));
  }
  const varMediaOf = (id) => (modal?.media || []).find((m) => m.variant_id === id);
  const varPhotoOf = (r) => (r.isNew
    ? (r.file ? URL.createObjectURL(r.file) : null)
    : (varMediaOf(r.id) ? mediaUrl(varMediaOf(r.id)) : null));
  // Foto de una variación. Si el producto varía por color, se aplica también
  // a las variaciones del mismo color que aún no tienen foto.
  async function onVarPhoto(row, file) {
    const color = colorAxisOf(varAxes);
    const same = color && row.attributes?.[color]
      ? varRows.filter((r) => r.key !== row.key && r.attributes?.[color] === row.attributes[color] && !varPhotoOf(r))
      : [];
    for (const r of [row, ...same]) {
      if (r.isNew) { patchVarRow(r.key, { file }); continue; }
      const old = varMediaOf(r.id);
      await onUploadImage(file, r.id);
      if (old && r.key === row.key) await onRemoveImage(old);
    }
  }
  async function onDeleteVariantInModal(v) {
    if (modal.variants.length <= 1) { setError('Un producto debe tener al menos una variación.'); return; }
    const label = labelOf(modal.axes, v.attributes) || 'estándar';
    if (!await ask({ title: `¿Eliminar la variación ${label}?`, message: `Se quita de ${modal.name} junto con su stock.`, confirmLabel: 'Eliminar variación' })) return;
    try {
      await deleteVariant(v.id);
      setM({ variants: modal.variants.filter((x) => x.id !== v.id) });
      await reload();
    } catch (e) { setError(e.message); }
  }
  const varMenu = (r) => {
    const v = modal.variants.find((x) => x.id === r.id);
    if (!v) return [];
    const label = labelOf(modal.axes, v.attributes) || 'Estándar';
    const photo = varMediaOf(v.id);
    return [
      { label: 'Registrar entrada', hidden: !canStock, onClick: () => setMove({ productId: modal.id, variantId: v.id, label, type: 'in', quantity: '', note: '' }) },
      { label: 'Registrar salida', hidden: !canStock, onClick: () => setMove({ productId: modal.id, variantId: v.id, label, type: 'out', quantity: '', note: '' }) },
      { label: 'Trasladar a otra sucursal', hidden: !canStock || !multiBranch, onClick: () => setTransfer({ productId: modal.id, variantId: v.id, label, to: '', quantity: '' }) },
      { label: 'Cambiar características', hidden: !canInfo || modal.axes.length === 0, onClick: () => setEditVar(v) },
      { label: 'Ver foto', hidden: !photo, onClick: () => setPhoto({ src: mediaUrl(photo), media: photo }) },
      { label: 'Quitar foto', hidden: !photo || lockMedia, onClick: () => onRemoveImage(photo) },
      { label: 'Eliminar variación', danger: true, hidden: !canDelete || modal.variants.length <= 1, onClick: () => onDeleteVariantInModal(v) },
    ];
  };


  // ---------- Lista: resumen, filtros agrupados y orden ----------
  const stockOf = (p) => variantsOf(p).reduce((s, v) => s + branchStock(v, branchId), 0);
  const costValueOf = (p) => variantsOf(p).reduce((s, v) => s + branchStock(v, branchId) * Number(v.cost ?? p.cost ?? 0), 0);
  const priceValueOf = (p) => variantsOf(p).reduce((s, v) => s + branchStock(v, branchId) * Number(offerPrice(v.price ?? p.price, p) || 0), 0);
  const sortedProducts = [...visibleProducts].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    if (sort.key === 'price') return dir * (Number(a.price) - Number(b.price));
    if (sort.key === 'stock') return dir * (stockOf(a) - stockOf(b));
    if (sort.key === 'value') return dir * (costValueOf(a) - costValueOf(b));
    return dir * a.name.localeCompare(b.name);
  });
  const all = products || [];
  const summary = {
    products: all.length,
    variants: all.reduce((s, p) => s + (isSimple(p) ? 0 : variantsOf(p).length), 0),
    units: all.reduce((s, p) => s + stockOf(p), 0),
    out: all.filter((p) => stockOf(p) <= 0).length,
    cost: all.reduce((s, p) => s + costValueOf(p), 0),
    price: all.reduce((s, p) => s + priceValueOf(p), 0),
    withCost: all.some((p) => Number(p.cost) > 0 || variantsOf(p).some((v) => Number(v.cost) > 0)),
  };
  const lowList = all.flatMap((p) => variantsOf(p).filter(isLow).map((v) => ({ p, v })));
  const activeFilters = [
    ptype !== 'all' && { key: 'ptype', label: ptype === 'variants' ? 'Con variantes' : 'Simples', clear: () => setPtype('all') },
    stockFilter !== 'all' && { key: 'stock', label: STOCK_FILTERS.find(([k]) => k === stockFilter)[1], clear: () => setStockFilter('all') },
    offerOnly && { key: 'offer', label: 'En oferta', clear: () => setOfferOnly(false) },
    ...Object.entries(filters).filter(([, v]) => v).map(([taxId, termId]) => ({
      key: taxId, label: `${taxonomies.find((t) => t.id === taxId)?.name}: ${termName.get(termId)}`,
      clear: () => setFilters((f) => ({ ...f, [taxId]: '' })),
    })),
  ].filter(Boolean);
  const clearFilters = () => { setPtype('all'); setStockFilter('all'); setOfferOnly(false); setFilters({}); };

  // Acciones de stock de una variación (entrada, salida, traslado) desde la lista.
  const stockItems = (p, v, label) => [
    { label: 'Registrar entrada', hint: 'Compra, reposición', hidden: !canStock || !v,
      onClick: () => setMove({ productId: p.id, variantId: v.id, label, type: 'in', quantity: '', note: '' }) },
    { label: 'Registrar salida', hint: 'Merma, consumo, regalo', hidden: !canStock || !v,
      onClick: () => setMove({ productId: p.id, variantId: v.id, label, type: 'out', quantity: '', note: '' }) },
    { label: 'Trasladar a otra sucursal', hidden: !canStock || !v || !multiBranch,
      onClick: () => setTransfer({ productId: p.id, variantId: v.id, label: label || 'Estándar', to: '', quantity: '' }) },
  ];

  const stockBadge = (p, n, low) => (
    n <= 0 ? <span className="inv-pill out">Sin stock</span>
      : low ? <span className="inv-pill low">Stock bajo</span> : null
  );

  return (
    <div className="page fin-page inv-page">
      <header className="page-head">
        <div>
          <h1>Inventario</h1>
          <p className="page-sub">Tus productos, sus variantes y cuánto hay{multiBranch && currentBranch ? ` en ${currentBranch.name}` : ''}.</p>
        </div>
        <div className="page-actions inv-head-actions">
          <Link to="/inventory/history" className="btn ghost">Historial</Link>
          {canCreate && (
            <RowMenu trigger="Importar" triggerClass="btn ghost" items={[
              { label: 'Importar desde CSV', hint: 'Carga muchos productos de una vez', onClick: () => importRef.current?.click() },
              { label: 'Descargar plantilla', hint: 'El archivo modelo para llenar en Excel', onClick: () => downloadInvTemplate(varTax.map((t) => t.name)) },
            ]} />
          )}
          {canCreate && <button className="btn primary" onClick={openCreate}>+ Nuevo producto</button>}
          <input ref={importRef} type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={onImportProducts} />
        </div>
      </header>

      {importMsg && (
        <div className="form-ok">
          {importMsg} <button className="linklike" onClick={() => setImportMsg(null)}>ok</button>
          {' · '}<button className="linklike" onClick={() => downloadInvTemplate(varTax.map((t) => t.name))}>descargar plantilla</button>
        </div>
      )}

      {error && !modal && <div className="form-error" onClick={() => setError(null)}>{error}</div>}

      {products !== null && products.length > 0 && (
        <div className="fin-kpis">
          <div className="card fin-kpi">
            <span className="fin-kpi-label">Productos</span>
            <strong className="fin-kpi-value">{summary.products}</strong>
            <span className="fin-kpi-sub">{summary.variants > 0 ? `${summary.variants} variantes` : 'sin variantes'}{summary.out > 0 ? ` · ${summary.out} sin stock` : ''}</span>
          </div>
          <div className="card fin-kpi">
            <span className="fin-kpi-label">Unidades en stock</span>
            <strong className="fin-kpi-value">{summary.units.toLocaleString('es-VE')}</strong>
            <span className="fin-kpi-sub">{multiBranch && currentBranch ? `en ${currentBranch.name}` : 'entre todos los productos'}</span>
          </div>
          <div className="card fin-kpi">
            <span className="fin-kpi-label">Valor en inventario</span>
            <strong className="fin-kpi-value">{summary.withCost ? `$${money(summary.cost)}` : '—'}</strong>
            <span className="fin-kpi-sub">{summary.withCost ? 'lo que te costó lo que tienes' : 'agrega el costo para calcularlo'}</span>
          </div>
          <div className="card fin-kpi">
            <span className="fin-kpi-label">Valor a precio de venta</span>
            <strong className="fin-kpi-value">${money(summary.price)}</strong>
            <span className="fin-kpi-sub">{summary.withCost ? `ganancia posible $${money(summary.price - summary.cost)}` : 'si vendes todo lo que tienes'}</span>
          </div>
        </div>
      )}

      {lowList.length > 0 && stockFilter !== 'low' && (
        <div className="fin-alert">
          <span className="fin-alert-icon" aria-hidden="true">!</span>
          <span className="fin-alert-text">
            <strong>{lowList.length === 1 ? '1 variante con stock bajo' : `${lowList.length} variantes con stock bajo`}</strong>
            <span> · {lowList.slice(0, 3).map(({ p, v }) => `${p.name}${variantLabel(v.attributes) ? ` (${variantLabel(v.attributes)})` : ''}`).join(', ')}{lowList.length > 3 ? '…' : ''}</span>
          </span>
          <button type="button" className="btn sm" onClick={() => setStockFilter('low')}>Ver cuáles</button>
        </div>
      )}

      {products === null ? (
        <div className="card fin-board"><div className="fin-empty"><span className="muted">Cargando…</span></div></div>
      ) : products.length === 0 ? (
        <div className="card fin-board">
          <div className="fin-empty">
            <div className="fin-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 8l8-4 8 4v8l-8 4-8-4V8z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M4 8l8 4 8-4M12 12v8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
            </div>
            <p className="fin-empty-title">Aún no tienes productos</p>
            <p className="muted">Agrégalos uno por uno o carga muchos a la vez con la plantilla de Excel.</p>
            {canCreate && (
              <div className="inv-empty-actions">
                <button type="button" className="btn primary" onClick={openCreate}>+ Nuevo producto</button>
                <button type="button" className="btn" onClick={() => importRef.current?.click()}>Importar CSV</button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card fin-board inv-board">
          <div className="fin-toolbar inv-toolbar">
            <div className="fin-search-wrap">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              <input type="search" className="fin-search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, SKU, color, talla…" aria-label="Buscar productos" />
            </div>

            <div className="inv-filter" ref={filterRef}>
              <button type="button" className={`inv-filter-btn${activeFilters.length ? ' on' : ''}`}
                aria-expanded={filterOpen} aria-haspopup="dialog" onClick={() => setFilterOpen((o) => !o)}>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>
                Filtros
                {activeFilters.length > 0 && <span className="inv-filter-count">{activeFilters.length}</span>}
              </button>
              {filterOpen && <div className="inv-filter-scrim" aria-hidden="true" onClick={() => setFilterOpen(false)} />}
              {filterOpen && (
                <div className="inv-filter-pop" role="dialog" aria-label="Filtros">
                  <div className="inv-filter-head">
                    <strong>Filtros</strong>
                    <button type="button" className="fm-link" disabled={!activeFilters.length} onClick={clearFilters}>Limpiar todo</button>
                  </div>
                  <div className="inv-filter-body">
                    <div className="inv-filter-group">
                      <span className="fm-label">Existencias</span>
                      <div className="chip-row">
                        {STOCK_FILTERS.map(([k, l]) => (
                          <button key={k} type="button" className={`chip${stockFilter === k ? ' on' : ''}`} onClick={() => setStockFilter(k)}>{l}</button>
                        ))}
                      </div>
                    </div>
                    <div className="inv-filter-group">
                      <span className="fm-label">Tipo de producto</span>
                      <div className="chip-row">
                        {[['all', 'Todos'], ['simple', 'Simples'], ['variants', 'Con variantes']].map(([k, l]) => (
                          <button key={k} type="button" className={`chip${ptype === k ? ' on' : ''}`} onClick={() => setPtype(k)}>{l}</button>
                        ))}
                      </div>
                    </div>
                    <label className="fin-check inv-filter-check">
                      <input type="checkbox" checked={offerOnly} onChange={(e) => setOfferOnly(e.target.checked)} />
                      Solo productos en oferta
                    </label>
                    {filterables.length > 0 && (
                      <div className="inv-filter-group">
                        <span className="fm-label">Categorías y propiedades</span>
                        <div className="inv-filter-selects">
                          {filterables.map((t) => (
                            <label key={t.id} className="inv-filter-select">
                              <span>{t.name}</span>
                              <select value={filters[t.id] || ''} onChange={(e) => setFilters((f) => ({ ...f, [t.id]: e.target.value }))}>
                                <option value="">Todas</option>
                                {t.taxonomy_terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}
                              </select>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="inv-filter-foot">
                    <button type="button" className="btn primary block" onClick={() => setFilterOpen(false)}>
                      Ver {visibleProducts.length} {visibleProducts.length === 1 ? 'producto' : 'productos'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <span className="inv-toolbar-gap" />
            {summary.withCost && (
              <span className="fin-total inv-value-pill" title="Valor al costo de lo que muestra la lista">
                Valor: <strong>${money(sortedProducts.reduce((s, p) => s + costValueOf(p), 0))}</strong>
              </span>
            )}
            {canPrice && !offerMode && (
              <button type="button" className="btn sm inv-offer-btn" onClick={() => setOfferMode(true)}>
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0l-8.3-8.3z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg>
                Ofertas
              </button>
            )}
          </div>

          {activeFilters.length > 0 && (
            <div className="inv-active">
              {activeFilters.map((f) => (
                <span key={f.key} className="inv-active-chip">
                  {f.label}
                  <button type="button" aria-label={`Quitar filtro ${f.label}`} onClick={f.clear}>
                    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
                  </button>
                </span>
              ))}
              <button type="button" className="fm-link" onClick={clearFilters}>Limpiar filtros</button>
            </div>
          )}

          {/* -------- Modo ofertas: aplicar/quitar % o precio fijo a la selección -------- */}
          {offerMode && (
            <div className="inv-offer-bar">
              <div className="inv-offer-sel">
                <strong>{offerSel.size} {offerSel.size === 1 ? 'seleccionado' : 'seleccionados'}</strong>
                <button type="button" className="fm-link" onClick={() => {
                  const ids = visibleProducts.map((p) => p.id);
                  setOfferSel((s) => (s.size === ids.length ? new Set() : new Set(ids)));
                }}>
                  {offerSel.size === visibleProducts.length && offerSel.size > 0 ? 'Quitar selección' : 'Seleccionar todos'}
                </button>
              </div>
              <div className="inv-offer-controls">
                <div className="seg sm" role="group" aria-label="Tipo de oferta">
                  <button type="button" className={`seg-btn${offerKind === 'percent' ? ' active' : ''}`}
                    onClick={() => { setOfferKind('percent'); setOfferPct(''); }}>% descuento</button>
                  <button type="button" className={`seg-btn${offerKind === 'price' ? ' active' : ''}`}
                    onClick={() => { setOfferKind('price'); setOfferPct(''); }}>Precio fijo</button>
                </div>
                <div className="fm-input-affix inv-offer-input">
                  <input type="number" min={offerKind === 'percent' ? 1 : 0.01} max={offerKind === 'percent' ? 99 : undefined}
                    step={offerKind === 'percent' ? 1 : 0.01} placeholder={offerKind === 'percent' ? '20' : '5,00'}
                    value={offerPct} onChange={(e) => setOfferPct(e.target.value)} aria-label="Valor de la oferta" />
                  <span>{offerKind === 'percent' ? '%' : '$'}</span>
                </div>
                <button type="button" className="btn primary sm"
                  disabled={busy || offerSel.size === 0 || !(offerKind === 'percent' ? Number(offerPct) > 0 && Number(offerPct) < 100 : Number(offerPct) > 0)}
                  onClick={() => applyOffer(offerKind === 'percent' ? { percent: Number(offerPct) } : { price: Number(offerPct) })}>
                  Aplicar
                </button>
                <button type="button" className="btn sm" disabled={busy || offerSel.size === 0} onClick={() => applyOffer({})}>Quitar oferta</button>
                <button type="button" className="btn ghost sm" onClick={exitOfferMode}>Listo</button>
              </div>
            </div>
          )}

          {visibleProducts.length === 0 ? (
            <div className="fin-empty">
              <p className="fin-empty-title">Ningún producto coincide</p>
              <p className="muted">Prueba con otra búsqueda o quita algún filtro.</p>
              <button type="button" className="btn" onClick={() => { clearFilters(); setSearch(''); }}>Quitar filtros</button>
            </div>
          ) : (
            <>
              <div className="inv-table">
                <table className="inv-tbl">
                  <thead>
                    <tr>
                      {offerMode && <th className="inv-col-check" />}
                      <th><SortHead label="Producto" k="name" sort={sort} setSort={setSort} /></th>
                      <th className="inv-col-sku">SKU</th>
                      <th className="num"><SortHead label="Precio" k="price" sort={sort} setSort={setSort} align="right" /></th>
                      <th className="num"><SortHead label="Stock" k="stock" sort={sort} setSort={setSort} align="right" /></th>
                      <th className="num inv-col-value"><SortHead label="Valor" k="value" sort={sort} setSort={setSort} align="right" /></th>
                      <th className="inv-col-actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProducts.map((p) => {
                      const simple = isSimple(p);
                      const dv = defaultVariant(p);
                      const open = !!expanded[p.id];
                      const n = stockOf(p);
                      const low = simple ? dv && isLow(dv) : productHasLow(p);
                      const tags = (p.product_terms || []).map((pt) => termName.get(pt.term_id)).filter(Boolean);
                      const value = costValueOf(p);
                      return (
                        <Fragment key={p.id}>
                          <tr className={`inv-row${open ? ' open' : ''}${offerSel.has(p.id) ? ' selected' : ''}`}
                            onClick={() => (offerMode ? toggleOfferSel(p.id) : !simple && setExpanded((s) => ({ ...s, [p.id]: !s[p.id] })))}>
                            {offerMode && (
                              <td className="inv-col-check" onClick={(e) => e.stopPropagation()}>
                                <input type="checkbox" className="offer-check" checked={offerSel.has(p.id)}
                                  onChange={() => toggleOfferSel(p.id)} aria-label={`Seleccionar ${p.name}`} />
                              </td>
                            )}
                            <td>
                              <div className="inv-prod">
                                <span className="inv-expander">
                                  {!simple && (
                                    <button type="button" className={`tree-toggle${open ? ' open' : ''}`} aria-expanded={open}
                                      aria-label={open ? 'Ocultar variantes' : 'Ver variantes'}
                                      onClick={(e) => { e.stopPropagation(); setExpanded((s) => ({ ...s, [p.id]: !s[p.id] })); }}>{ICON.chevron}</button>
                                  )}
                                </span>
                                <span className={`list-thumb${productImg(p) ? ' thumb-click' : ''}`}
                                  title={productImg(p) ? 'Ver fotos' : undefined}
                                  onClick={(e) => { if (productImg(p)) { e.stopPropagation(); openViewer(p); } }}>
                                  {productImg(p) ? <img src={productImg(p)} alt="" loading="lazy" /> : <span className="thumb-ph">{p.name.slice(0, 1)}</span>}
                                </span>
                                <span className="inv-prod-text">
                                  <span className="inv-prod-name">
                                    {canEdit && !offerMode
                                      ? <button type="button" className="inv-name-btn" onClick={(e) => { e.stopPropagation(); openEdit(p); }}>{p.name}</button>
                                      : <strong>{p.name}</strong>}
                                    {hasOffer(p) && <span className="inv-pill offer">{offerTag(p)}</span>}
                                  </span>
                                  <span className="inv-prod-meta">
                                    {!simple && <span>{variantsOf(p).length} variantes</span>}
                                    {tags.length > 0 && <span>{tags.join(' · ')}</span>}
                                    {p.note && <span className="inv-note" title={p.note}>{p.note}</span>}
                                  </span>
                                </span>
                              </div>
                            </td>
                            <td className="inv-col-sku mono">{p.sku || <span className="fin-faint">—</span>}</td>
                            <td className="num">
                              {hasOffer(p) ? (
                                <span className="inv-num">
                                  <strong>${money(offerPrice(p.price, p))}</strong>
                                  <small className="offer-old">${money(p.price)}</small>
                                </span>
                              ) : (
                                <span className="inv-num">
                                  <strong>${money(p.price)}</strong>
                                  {Number(p.cost) > 0 && <small>costo ${money(p.cost)}</small>}
                                </span>
                              )}
                            </td>
                            <td className="num">
                              <span className="inv-num">
                                <strong className={n <= 0 ? 'inv-zero' : ''}>{n.toLocaleString('es-VE')} <span className="inv-unit">{p.unit}</span></strong>
                                {stockBadge(p, n, low) || (multiBranch && <small>total {totalStock(p)}</small>)}
                              </span>
                            </td>
                            <td className="num inv-col-value">
                              {value > 0 ? <span className="inv-num"><strong>${money(value)}</strong></span> : <span className="fin-faint">—</span>}
                            </td>
                            <td className="inv-col-actions" onClick={(e) => e.stopPropagation()}>
                              <div className="inv-actions-cell">
                                {canEdit && !offerMode && (
                                  <button type="button" className="inv-icon-btn" title="Editar producto" aria-label={`Editar ${p.name}`}
                                    onClick={() => openEdit(p)}>{ICON.edit}</button>
                                )}
                                {!offerMode && (
                                  <RowMenu items={[
                                    { label: 'Editar producto', onClick: () => openEdit(p), hidden: !canEdit },
                                    ...(simple ? stockItems(p, dv, '') : []),
                                    { label: open ? 'Ocultar variantes' : 'Ver variantes', hidden: simple,
                                      onClick: () => setExpanded((s) => ({ ...s, [p.id]: !s[p.id] })) },
                                    { label: 'div', divider: true, hidden: !canDelete },
                                    { label: 'Eliminar producto', danger: true, hidden: !canDelete, onClick: () => onDeleteProduct(p) },
                                  ]} />
                                )}
                              </div>
                            </td>
                          </tr>
                          {!simple && open && variantsOf(p).map((v) => {
                            const label = variantLabel(v.attributes, p.variant_axes) || 'Estándar';
                            const vn = branchStock(v, branchId);
                            const vValue = vn * Number(v.cost ?? p.cost ?? 0);
                            return (
                              <tr key={v.id} className="inv-var">
                                {offerMode && <td className="inv-col-check" />}
                                <td>
                                  <div className="inv-var-name">
                                    <span className="inv-var-dot" aria-hidden="true" />
                                    {label}
                                  </div>
                                </td>
                                <td className="inv-col-sku mono">{v.sku || <span className="fin-faint">—</span>}</td>
                                <td className="num">
                                  <span className="inv-num">
                                    {hasOffer(p)
                                      ? <><span>${money(offerPrice(v.price ?? p.price, p))}</span><small className="offer-old">${money(v.price ?? p.price)}</small></>
                                      : <span className={v.price == null ? 'fin-faint-text' : ''}>${money(v.price ?? p.price)}</span>}
                                  </span>
                                </td>
                                <td className="num">
                                  <span className="inv-num">
                                    <span className={vn <= 0 ? 'inv-zero' : ''}>{vn.toLocaleString('es-VE')}</span>
                                    {vn <= 0 ? <span className="inv-pill out">Sin stock</span>
                                      : isLow(v) ? <span className="inv-pill low">Stock bajo</span>
                                        : v.target_stock != null ? <small>objetivo {Number(v.target_stock)}</small>
                                          : multiBranch ? <small>total {Number(v.stock)}</small> : null}
                                  </span>
                                </td>
                                <td className="num inv-col-value">{vValue > 0 ? `$${money(vValue)}` : <span className="fin-faint">—</span>}</td>
                                <td className="inv-col-actions">
                                  <div className="inv-actions-cell">
                                    <RowMenu items={[
                                      ...stockItems(p, v, label),
                                      { label: 'div', divider: true, hidden: !canDelete || !canStock },
                                      { label: 'Quitar variante', danger: true, hidden: !canDelete, onClick: () => onDeleteVariant(p, v) },
                                    ]} />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* -------- Celular: tarjetas desplegables -------- */}
              <div className="inv-cards">
                {sortedProducts.map((p) => {
                  const simple = isSimple(p);
                  const dv = defaultVariant(p);
                  const open = expanded[p.id];
                  const n = stockOf(p);
                  const low = simple ? dv && isLow(dv) : productHasLow(p);
                  return (
                    <div className={`inv-card${offerSel.has(p.id) ? ' selected' : ''}`} key={p.id}>
                      <button type="button" className="inv-card-head" aria-expanded={!!open}
                        onClick={() => {
                          if (offerMode) { toggleOfferSel(p.id); return; }
                          setExpanded((s) => ({ ...s, [p.id]: !s[p.id] }));
                        }}>
                        {offerMode && <input type="checkbox" className="offer-check" checked={offerSel.has(p.id)} readOnly tabIndex={-1} aria-hidden="true" />}
                        <span className={`list-thumb${productImg(p) ? ' thumb-click' : ''}`}
                          onClick={(e) => { if (!offerMode && productImg(p)) { e.stopPropagation(); openViewer(p); } }}>
                          {productImg(p) ? <img src={productImg(p)} alt="" loading="lazy" /> : <span className="thumb-ph">{p.name.slice(0, 1)}</span>}
                        </span>
                        <span className="inv-card-info">
                          <span className="inv-card-name">
                            {p.name}
                            {hasOffer(p) && <span className="inv-pill offer">{offerTag(p)}</span>}
                          </span>
                          <span className="inv-card-line">
                            <strong>${money(offerPrice(p.price, p))}</strong>
                            {hasOffer(p) && <span className="offer-old">${money(p.price)}</span>}
                            <span className="inv-card-sep">·</span>
                            <span className={n <= 0 ? 'inv-zero' : ''}>{n} {p.unit}</span>
                            {stockBadge(p, n, low)}
                          </span>
                          <span className="muted inv-card-tags">
                            {[!simple && `${variantsOf(p).length} variantes`, p.sku, ...(p.product_terms || []).map((pt) => termName.get(pt.term_id))].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className={`inv-card-chev${open ? ' open' : ''}`} aria-hidden="true">{ICON.chevron}</span>
                      </button>
                      {open && !offerMode && (
                        <div className="inv-card-body">
                          {(simple ? [dv].filter(Boolean) : variantsOf(p)).map((v) => {
                            const label = simple ? 'Existencias' : (variantLabel(v.attributes, p.variant_axes) || 'Estándar');
                            const vn = branchStock(v, branchId);
                            return (
                              <div className="inv-var-row" key={v.id}>
                                <div className="inv-var-info">
                                  <span>{label}{isLow(v) && <span className="inv-pill low">Stock bajo</span>}</span>
                                  <span className="muted"><strong>{vn}</strong> en stock{!simple && ` · $${money(offerPrice(v.price ?? p.price, p))}`}</span>
                                </div>
                                <div className="inv-var-actions">
                                  <RowMenu items={[
                                    ...stockItems(p, v, simple ? '' : label),
                                    { label: 'Quitar variante', danger: true, hidden: simple || !canDelete, onClick: () => onDeleteVariant(p, v) },
                                  ]} />
                                </div>
                              </div>
                            );
                          })}
                          {(canEdit || canDelete) && (
                            <div className="inv-card-foot">
                              {canEdit && <button className="btn sm" onClick={() => openEdit(p)}>{ICON.edit} Editar</button>}
                              {canDelete && <button className="btn danger sm" onClick={() => onDeleteProduct(p)}>{ICON.trash} Eliminar</button>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="inv-foot">
                {visibleProducts.length === products.length
                  ? `${products.length} ${products.length === 1 ? 'producto' : 'productos'}`
                  : `${visibleProducts.length} de ${products.length} productos`}
              </div>
            </>
          )}
        </div>
      )}

      {/* ============ Modal crear / editar producto ============ */}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal card modal-wide np-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{modal.mode === 'create' ? 'Nuevo producto' : 'Editar producto'}</h2>
              <button className="btn ghost sm" onClick={() => setModal(null)}>Cerrar</button>
            </div>
            <form onSubmit={onSubmit} className="vform">
              {editing && (lockInfo || lockPrice || lockStock || lockMedia) && (
                <p className="hint">
                  Los campos en gris no los puedes cambiar con tus permisos actuales.
                </p>
              )}
              <div className="np-grid">
                <label className="np-name">Nombre
                  <input value={modal.name} onChange={(e) => setM({ name: e.target.value })} required autoFocus placeholder="Camisa Oxford" disabled={lockInfo} />
                </label>
                <label>Precio (USD)
                  <input type="number" step="0.01" min="0" value={modal.price} onChange={(e) => setM({ price: e.target.value })} placeholder="0,00" disabled={lockPrice} />
                </label>
                <label title="Lo que te costó comprar o producir una unidad; sirve para calcular la utilidad">Costo (USD)
                  <input type="number" step="0.01" min="0" value={modal.cost} onChange={(e) => setM({ cost: e.target.value })} placeholder="0,00" disabled={lockPrice} />
                </label>
                <label>SKU
                  <input value={modal.sku} onChange={(e) => setM({ sku: e.target.value })} placeholder="CAM-OXF" disabled={lockInfo} />
                </label>
                {modal.mode === 'create' && modal.vb.length === 0 && (
                  <label>Cantidad
                    <input type="number" step="1" min="0" value={modal.simpleStock}
                      onChange={(e) => setM({ simpleStock: e.target.value })} placeholder="0" />
                  </label>
                )}
                {/* La unidad (products.unit) se mantiene internamente con su
                    default 'und'; se configurará por negocio más adelante. */}
                <label className="np-name">Nota (opcional)
                  <textarea rows={2} value={modal.note} placeholder="p. ej. Este pantalón tiene una mancha" disabled={lockInfo}
                    onChange={(e) => setM({ note: e.target.value })} />
                </label>
              </div>

              {(() => {
                // Producto simple: también puede fijar Talla, Color, etc. como
                // dato del producto (sin crear variaciones); alimenta los
                // filtros del POS y del inventario igual que las categorías.
                const simpleNow = modal.mode === 'create' ? modal.vb.length === 0 : modal.axes.length === 0;
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
                            placeholder={`Elegir ${t.name.toLowerCase()}…`} disabled={lockInfo} />
                        </label>
                      ))}
                    </div>
                    {simpleNow && varTax.length > 0 && (
                      <p className="hint">Talla, color, etc. de un producto que viene en una sola versión. Si lo vendes en varias, usa Variaciones más abajo.</p>
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
                          <img src={URL.createObjectURL(f)} alt="" title="Ver en grande"
                            onClick={() => setPhoto({ src: URL.createObjectURL(f), staged: i })} />
                          <button type="button" className="img-del" onClick={() => setM({ stagedFiles: modal.stagedFiles.filter((_, j) => j !== i) })}>×</button>
                        </div>
                      ))
                    : (modal.media || []).filter((m) => !m.variant_id).map((m) => (
                        <div className="img-thumb" key={m.id}>
                          <img src={mediaUrl(m)} alt="" title="Ver en grande"
                            onClick={() => setPhoto({ src: mediaUrl(m), media: m })} />
                          {!lockMedia && <button type="button" className="img-del" onClick={() => onRemoveImage(m)}>×</button>}
                        </div>
                      ))}
                  {!lockMedia && (
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
                  )}
                </div>
              </div>

              {/* -------- Cantidad de un producto simple ya guardado -------- */}
              {editing && simpleEdit && (
                <div className="np-block">
                  <div className="oc-label">Cantidad</div>
                  {modal.variants.map((v, i) => {
                    const patch = (p) => setM({ variants: modal.variants.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                    return (
                      <div key={v.id}>
                        <div className="vb-fields">
                          <label className="vb-field">Cantidad
                            <input type="number" min="0" step="1" value={v.stock} disabled={lockStock}
                              onChange={(e) => patch({ stock: e.target.value })} />
                          </label>
                        </div>
                        {stockButtons(v)}
                      </div>
                    );
                  })}
                  {!lockStock && (
                    <p className="hint">
                      Cambiar la cantidad aquí registra un ajuste. Para dejar constancia de una entrada
                      o salida (con su nota) usa los botones de arriba.
                    </p>
                  )}
                </div>
              )}

              {/* -------- Variaciones: siempre visibles; sin filas, el producto es simple -------- */}
              <div className="np-block">
                <div className="np-var-head">
                  <div className="oc-label">Variaciones</div>
                  {varRows.length > 0 && canAddVar && (
                    <button type="button" className="btn ghost sm" disabled={busy} onClick={openGen}>＋ Agregar variaciones</button>
                  )}
                </div>
                {varRows.length === 0 ? (
                  <div className="np-var-empty">
                    <div>
                      <p className="np-var-empty-title">Este producto no tiene variaciones</p>
                      <p className="muted">Agrégalas si lo vendes en varias tallas, colores u otra característica.</p>
                    </div>
                    {canAddVar && (
                      <button type="button" className="btn ghost" disabled={busy} onClick={openGen}>＋ Agregar variaciones</button>
                    )}
                  </div>
                ) : (
                  <>
                    <VariantTable
                      axes={varAxes}
                      rows={varRows}
                      termsOf={(a) => axisTermsByName(a).map((t) => t.name)}
                      onPatch={patchVarRow}
                      onBulk={bulkVarRows}
                      onRemove={removeVarRow}
                      onPhoto={onVarPhoto}
                      photoOf={varPhotoOf}
                      menuFor={varMenu}
                      lock={{ stock: lockStock, price: lockPrice, info: lockInfo, media: lockMedia }}
                      showTarget={editing}
                      disabled={busy}
                      photoHint={colorAxisOf(varAxes) && varAxes.length > 1 ? `La foto se aplica a todas las variaciones del mismo ${colorAxisOf(varAxes).toLowerCase()}.` : null}
                    />
                    {editing && !lockStock && (
                      <p className="hint">Cambiar la cantidad registra un ajuste. Para una entrada o salida con su nota, usa ⋯ en la variación.</p>
                    )}
                  </>
                )}
              </div>

              {error && <div className="form-error">{error}</div>}
              <div className="inline-form-actions">
                <button className="btn primary lg" disabled={busy}>{busy ? 'Guardando…' : 'Guardar producto'}</button>
                <button type="button" className="btn ghost" onClick={() => setModal(null)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ Visor de fotos del producto ============ */}
      {viewer && (() => {
        const p = viewer.p;
        const media = mediaOf(p);
        const m = media[viewer.i] || media[0];
        const stock = variantsOf(p).reduce((s, v) => s + branchStock(v, branchId), 0);
        const tags = (p.product_terms || []).map((pt) => termName.get(pt.term_id)).filter(Boolean);
        const mVar = m?.variant_id ? variantsOf(p).find((v) => v.id === m.variant_id) : null;
        const go = (d) => setViewer((s) => ({ ...s, i: (s.i + d + media.length) % media.length }));
        return (
          <div className="modal-backdrop" onClick={() => setViewer(null)}>
            <div className="modal card photo-viewer" onClick={(e) => e.stopPropagation()}>
              <div className="pv-img">
                <img src={mediaUrl(m)} alt={p.name} />
                {media.length > 1 && (
                  <>
                    <button type="button" className="pv-nav prev" aria-label="Foto anterior" onClick={() => go(-1)}>‹</button>
                    <button type="button" className="pv-nav next" aria-label="Foto siguiente" onClick={() => go(1)}>›</button>
                    <span className="pv-count">{viewer.i + 1} / {media.length}</span>
                  </>
                )}
                <button type="button" className="pv-close" aria-label="Cerrar" onClick={() => setViewer(null)}>×</button>
              </div>
              <div className="pv-info">
                <div className="pv-name">
                  {p.name}
                  {mVar && <span className="muted"> · {variantLabel(mVar.attributes, p.variant_axes) || 'Estándar'}</span>}
                </div>
                <div className="muted">
                  {p.sku ? `${p.sku} · ` : ''}
                  {hasOffer(p)
                    ? <><span className="offer-old">{money(p.price)}</span> {money(offerPrice(p.price, p))}{Number(p.offer_percent) > 0 && ` (${offerTag(p)})`}</>
                    : money(p.price)}
                  {' · '}<strong>{stock}</strong> {p.unit} en stock
                  {!isSimple(p) && ` · ${variantsOf(p).length} variantes`}
                </div>
                {tags.length > 0 && <div className="muted">{tags.join(' · ')}</div>}
                {p.note && <div className="product-note">📝 {p.note}</div>}
                {canEdit && (
                  <button type="button" className="btn ghost sm" onClick={() => { setViewer(null); openEdit(p); }}>
                    {ICON.edit} Editar producto
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== Foto del producto en grande, con opción de reemplazarla ===== */}
      {photo && modal && (
        <div className="modal-backdrop stacked" onClick={() => setPhoto(null)}>
          <div className="modal card photo-edit" role="dialog" aria-modal="true"
            onClick={(e) => e.stopPropagation()}>
            <div className="pe-img"><img src={photo.src} alt="" /></div>
            <div className="inline-form-actions pe-actions">
              {!lockMedia && (
                <label className="btn primary">
                  Reemplazar foto
                  <input type="file" accept="image/*" hidden disabled={busy}
                    onChange={async (e) => {
                      const f = e.target.files[0];
                      e.target.value = '';
                      if (!f) return;
                      if (photo.media) {
                        // Entra la nueva y sale la vieja, para no dejar huecos.
                        await onUploadImage(f, photo.media.variant_id || null);
                        await onRemoveImage(photo.media);
                      } else {
                        setM({ stagedFiles: modal.stagedFiles.map((x, j) => (j === photo.staged ? f : x)) });
                      }
                      setPhoto(null);
                    }} />
                </label>
              )}
              <button type="button" className="btn ghost" onClick={() => setPhoto(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Submodal: editar una variación existente ===== */}
      {editVar && modal && (
        <VariationDialog
          axes={modal.axes.map((name) => ({ id: name, name, terms: axisTermsByName(name) }))}
          availableAxes={varTax.filter((t) => !modal.axes.includes(t.name))
            .map((t) => ({ id: t.id, name: t.name, terms: t.taxonomy_terms }))}
          onToggleAxis={null}
          busy={busy}
          taken={new Set(modal.variants.filter((x) => x.id !== editVar.id)
            .map((x) => sigOf(modal.axes, x.attributes)))}
          initial={{
            key: editVar.id, values: editVar.attributes, stock: editVar.stock,
            price: editVar.price, cost: editVar.cost, sku: editVar.sku,
          }}
          onAdd={(row) => setM({
            variants: modal.variants.map((x) => (x.id === editVar.id ? {
              ...x, attributes: row.attributes, stock: row.stock,
              price: row.price, cost: row.cost, sku: row.sku,
            } : x)),
          })}
          onClose={() => setEditVar(null)}
        />
      )}

      {/* ===== Modal: agregar variaciones (todas las combinaciones de una vez) ===== */}
      {genVar && modal && (
        <GenerateDialog
          allAxes={varTax.map((t) => ({ name: t.name, terms: t.taxonomy_terms }))}
          selected={varAxes}
          lockedAxes={varAxes.filter((a) => (editing && modal.origAxes.includes(a)) || varRows.some((r) => r.attributes?.[a]))}
          usedValues={Object.fromEntries(varAxes.map((a) => [a, [...new Set(varRows.map((r) => r.attributes?.[a]).filter(Boolean))]]))}
          taken={new Set(varRows.map((r) => sigOf(varAxes, r.attributes)))}
          existingCount={varRows.length}
          onToggleAxis={onToggleAxis}
          onGenerate={onGenerateVariants}
          onClose={closeGen}
          busy={busy}
          canStock={!lockStock}
          canPrice={!lockPrice}
        />
      )}

      {/* ============ Modal movimiento ============ */}
      {move && (
        <div className="modal-backdrop stacked" onClick={() => setMove(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>
              {MOVE_LABELS[move.type]} — {products.find((p) => p.id === move.productId)?.name || modal?.name}
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
        <div className="modal-backdrop stacked" onClick={() => setTransfer(null)}>
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

    </div>
  );
}
