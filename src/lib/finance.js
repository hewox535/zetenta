// Utilidades compartidas por Cuentas por cobrar/pagar y Gastos.
import { formatDate } from './calc';

export const num = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Fecha local en yyyy-mm-dd (no UTC: a las 9 p. m. en Venezuela ya sería "mañana").
export function localISO(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return localISO(new Date(y, m - 1, d + days));
}
// Días desde hoy hasta la fecha (negativo = ya pasó).
export function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - t) / 86400000);
}

// Etiqueta y tono del vencimiento: rojo vencida, ámbar pronto, gris lejos.
export function dueInfo(iso, soon = 7) {
  const n = daysUntil(iso);
  if (n === null) return { tone: 'none', label: 'Sin vencimiento', days: null };
  if (n < 0) return { tone: 'late', label: n === -1 ? 'Venció ayer' : `Vencida hace ${-n} días`, days: n };
  if (n === 0) return { tone: 'soon', label: 'Vence hoy', days: n };
  if (n === 1) return { tone: 'soon', label: 'Vence mañana', days: n };
  if (n <= soon) return { tone: 'soon', label: `Vence en ${n} días`, days: n };
  return { tone: 'ok', label: `Vence el ${formatDate(iso)}`, days: n };
}

// Descarga un CSV (con BOM para que Excel respete los acentos).
export function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(';')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const norm = (v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
