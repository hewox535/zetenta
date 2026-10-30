import { mediaUrl, fetchPublicCatalog } from '../../lib/api';
import { offerPrice } from '../../lib/calc';

// ---------- Datos ----------
// Caché por negocio: volver de un producto al listado pinta al instante y
// permite restaurar el scroll; igualmente se revalida en segundo plano.
const cache = new Map();
export const getCached = (businessId) => cache.get(businessId) || null;
export async function loadCatalog(businessId) {
  const data = await fetchPublicCatalog(businessId);
  if (data) cache.set(businessId, data);
  else cache.delete(businessId);
  return data;
}

// Scroll del listado al abrir un producto, para devolver al cliente donde estaba.
let savedScroll = 0;
export const saveScroll = () => { savedScroll = window.scrollY; };
export const takeScroll = () => savedScroll;

// ---------- Precios ----------
const nf = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// "$25" si es entero, "$25,50" si no: más limpio en una vitrina.
export function fmtPrice(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? `$${v}` : `$${nf.format(v)}`;
}

// Precio final de una variante (propio o heredado) con la oferta aplicada.
export function variantPrice(product, variant) {
  const base = variant?.price ?? product.price;
  return offerPrice(base, product);
}

// % de descuento que se muestra en la vitrina. Con precio fijo se calcula
// contra el precio normal; si no queda por debajo, no se anuncia rebaja.
export function offerPercentOf(product, base) {
  const fixed = Number(product.offer_price) || 0;
  if (fixed > 0) return base > fixed ? (1 - fixed / base) * 100 : 0;
  return Number(product.offer_percent) > 0 ? Number(product.offer_percent) : 0;
}
export function variantBase(product, variant) {
  return Number(variant?.price ?? product.price) || 0;
}

// Rango de precios del producto en todas sus variantes.
export function priceInfo(product) {
  const vs = product.variants?.length ? product.variants : [null];
  const finals = vs.map((v) => variantPrice(product, v));
  const bases = vs.map((v) => variantBase(product, v));
  const min = Math.min(...finals);
  const max = Math.max(...finals);
  const base = Math.min(...bases);
  return { price: min, from: max > min, base, offer: offerPercentOf(product, base) };
}

// ---------- Variantes ----------
export const isColorAxis = (axis) => /colou?r/i.test(axis || '');

export function axisOptions(product, axis) {
  const seen = [];
  for (const v of product.variants || []) {
    const val = v.attributes?.[axis];
    if (val && !seen.includes(val)) seen.push(val);
  }
  return seen;
}

// Ejes realmente usados: los declarados por el producto, o los que traen las variantes.
export function productAxes(product) {
  const declared = (product.axes || []).filter((a) => axisOptions(product, a).length > 0);
  if (declared.length) return declared;
  const keys = new Set();
  for (const v of product.variants || []) Object.keys(v.attributes || {}).forEach((k) => keys.add(k));
  return [...keys];
}

export function findVariant(product, selection) {
  return (product.variants || []).find((v) =>
    Object.entries(selection).every(([k, val]) => v.attributes?.[k] === val)) || null;
}

// Variante inicial: la primera disponible (o la primera, si todo está agotado).
export function defaultSelection(product, axes) {
  const vs = product.variants || [];
  const v = vs.find((x) => x.available) || vs[0];
  const sel = {};
  for (const a of axes) if (v?.attributes?.[a]) sel[a] = v.attributes[a];
  return sel;
}

// Al elegir un valor en un eje, conserva el resto de la selección si esa
// combinación existe; si no, salta a la variante más parecida (prefiriendo
// las disponibles) en vez de dejar al cliente en una combinación inexistente.
export function selectValue(product, axes, selection, axis, value) {
  const candidates = (product.variants || []).filter((v) => v.attributes?.[axis] === value);
  let best = null; let bestScore = -1;
  for (const v of candidates) {
    let score = v.available ? 0.5 : 0;
    for (const a of axes) if (a !== axis && v.attributes?.[a] === selection[a]) score += 1;
    if (score > bestScore) { best = v; bestScore = score; }
  }
  const next = {};
  for (const a of axes) next[a] = best?.attributes?.[a] ?? selection[a];
  return next;
}

// ¿Esa opción se puede comprar con el resto de la selección actual?
export function optionAvailable(product, axes, selection, axis, value) {
  return (product.variants || []).some((v) =>
    v.available && v.attributes?.[axis] === value
    && axes.every((a) => a === axis || v.attributes?.[a] === selection[a]));
}

export function variantText(variant, axes) {
  return axes.map((a) => variant?.attributes?.[a]).filter(Boolean).join(' · ');
}

// ---------- Imágenes ----------
const url = (m) => mediaUrl({ provider: 'supabase', bucket: m.bucket, path: m.path });

// Imagen de portada para tarjetas: la general del producto, o la primera que haya.
export function coverImages(product) {
  const media = product.media || [];
  const general = media.filter((m) => !m.variant_id);
  const ordered = [...general, ...media.filter((m) => m.variant_id)];
  return ordered.slice(0, 2).map(url);
}

// Galería del producto para la variante elegida: primero las fotos de esa
// variante (o, si no tiene, las de otra variante del mismo color/primer eje),
// luego las generales. Sin nada propio, todas.
export function galleryImages(product, variant, axes) {
  const media = product.media || [];
  const general = media.filter((m) => !m.variant_id);
  let own = variant ? media.filter((m) => m.variant_id === variant.id) : [];
  if (!own.length && variant && axes.length) {
    const key = axes.find(isColorAxis) || axes[0];
    const ids = new Set((product.variants || [])
      .filter((v) => v.attributes?.[key] === variant.attributes?.[key]).map((v) => v.id));
    own = media.filter((m) => m.variant_id && ids.has(m.variant_id));
  }
  const list = [...own, ...general];
  return (list.length ? list : media).map((m) => ({ id: m.id, src: url(m) }));
}

// ---------- Color ----------
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const COLORS = {
  negro: '#1d1d1f', blanco: '#ffffff', gris: '#8e8e93', 'gris claro': '#d1d1d6', 'gris oscuro': '#48484a',
  azul: '#1f5fd6', 'azul marino': '#14284b', marino: '#14284b', 'azul claro': '#8ec5ff', celeste: '#8ec5ff', navy: '#14284b',
  rojo: '#d92d20', vino: '#6d1a2a', vinotinto: '#6d1a2a', burgundy: '#6d1a2a', guinda: '#6d1a2a',
  rosa: '#f4a6c0', rosado: '#f4a6c0', fucsia: '#d6246e', morado: '#7a3fb5', lila: '#c3a6e6', violeta: '#7a3fb5',
  verde: '#2e9d57', 'verde oliva': '#6b7a2f', oliva: '#6b7a2f', 'verde militar': '#4b5320', menta: '#a8e0c5',
  amarillo: '#f5c518', mostaza: '#d4a017', naranja: '#f57c1f', coral: '#ff7f6e',
  beige: '#d9c3a0', crema: '#f2e8d5', arena: '#d8c39a', marron: '#7b4a2a', cafe: '#6f4e37', camel: '#c19a6b', kaki: '#b5a27a', khaki: '#b5a27a',
  dorado: '#d4af37', plateado: '#c0c0c0', plata: '#c0c0c0', turquesa: '#2bb7b3', denim: '#3b5f8f', jean: '#3b5f8f',
};
// null si no reconocemos el color: se muestra como píldora de texto.
export function colorHex(name) {
  const n = norm(name);
  if (COLORS[n]) return COLORS[n];
  const word = n.split(/[\s/-]+/).find((w) => COLORS[w]);
  return word ? COLORS[word] : null;
}
export const isMulticolor = (name) => /multi|estampad|variad|surtid/.test(norm(name));

// Texto legible sobre el color de acento de la marca.
export function onAccent(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.68 ? '#1d1d1f' : '#ffffff';
}

export function whatsappLink(number, text) {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
