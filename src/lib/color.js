// Utilidades de color para la marca de un negocio.

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// Versión más oscura (para el hover de los botones).
export function darken(hex, amount = 0.14) {
  if (!HEX_RE.test(hex)) return hex;
  return toHex(toRgb(hex).map((v) => v * (1 - amount)));
}

// Contraste WCAG del color contra el blanco (texto blanco sobre el botón).
export function contrastWithWhite(hex) {
  if (!HEX_RE.test(hex)) return 21;
  const L = toRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const lum = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
  return 1.05 / (lum + 0.05);
}

// Paleta sugerida para el registro: colores con buen contraste sobre blanco.
export const BRAND_SWATCHES = ['#2323FF', '#0A7CFF', '#0F8A6A', '#D7302A', '#E4572E', '#B8336A', '#6D3FD1', '#111111'];

// Subdominio a partir de un nombre (igual que business_slug() en la base).
export function toSlug(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}
