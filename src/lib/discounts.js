// Descuentos especiales (Black Friday, liquidaciones…). Misma lógica que
// best_discount() y create_order() en el servidor:
// - Por producto gana el mayor descuento especial vigente (no se suman).
// - De contado, en cada moneda se queda el mayor entre ese y el de contado.
// - Con Cashea, la venta va a precio de lista menos el % de Cashea de la promo.

// Fecha de hoy en Venezuela (YYYY-MM-DD), como el servidor.
export function todayVE() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());
}

// Estado de un descuento según sus fechas: 'off' | 'soon' | 'live' | 'ended'.
export function discountStatus(ds, today = todayVE()) {
  if (!ds.active) return 'off';
  if (ds.starts_on && ds.starts_on > today) return 'soon';
  if (ds.ends_on && ds.ends_on < today) return 'ended';
  return 'live';
}

export const isLive = (ds, today) => discountStatus(ds, today) === 'live';

export function appliesTo(ds, product) {
  if (!product) return false;
  if (ds.scope === 'all') return true;
  if (ds.scope === 'products') return (ds.product_ids || []).includes(product.id);
  const terms = new Set(ds.term_ids || []);
  return (product.product_terms || []).some((pt) => terms.has(pt.term_id));
}

const pctFor = (ds, mode) => Number(mode === 'cashea' ? ds.cashea_percent : ds.cash_percent) || 0;

// El mayor descuento vigente de un producto para 'cash' o 'cashea'.
export function bestDiscount(product, discounts, mode, skip) {
  let best = null;
  for (const ds of discounts) {
    if (skip?.has(ds.id) || !appliesTo(ds, product)) continue;
    const pct = pctFor(ds, mode);
    if (pct > 0 && (!best || pct > best.pct)) best = { id: ds.id, name: ds.name, pct };
  }
  return best;
}

// Aplica los descuentos vigentes al carrito.
// lines: [{ id, productId, price, qty }]. d/dv: descuento de contado en divisa
// y en bolívares (fracción). Devuelve:
// - d, dv: descuento efectivo de cada moneda de contado según la mezcla.
// - casheaOff: lo que rebajan las promos si la venta va con Cashea ($).
// - perLine: Map(lineId → { cash, cashea }) con la promo de cada artículo.
// - rows: las promos que tocan esta venta (también las quitadas, para volver
//   a marcarlas) con cuántos artículos califican y su % de contado y Cashea.
export function applyDiscounts(lines, productsById, discounts, skip, { d = 0, dv = 0 } = {}) {
  const perLine = new Map();
  const rows = new Map();
  let total = 0; let tVes = 0; let tUsd = 0; let casheaOff = 0;
  for (const l of lines) {
    const p = productsById.get(l.productId);
    const amount = l.price * l.qty;
    total += amount;
    // Las quitadas también cuentan para mostrar su fila.
    for (const ds of discounts) {
      if (!appliesTo(ds, p)) continue;
      if (!(pctFor(ds, 'cash') > 0 || pctFor(ds, 'cashea') > 0)) continue;
      const r = rows.get(ds.id) || { id: ds.id, name: ds.name, cash: pctFor(ds, 'cash'), cashea: pctFor(ds, 'cashea'), count: 0, used: { cash: 0, cashea: 0 } };
      r.count += l.qty;
      rows.set(ds.id, r);
    }
    const cash = bestDiscount(p, discounts, 'cash', skip);
    const cashea = bestDiscount(p, discounts, 'cashea', skip);
    perLine.set(l.id, { cash, cashea });
    if (cash) rows.get(cash.id).used.cash += l.qty;
    if (cashea) rows.get(cashea.id).used.cashea += l.qty;
    const pc = (cash?.pct || 0) / 100;
    tVes += amount * (1 - Math.max(pc, dv));
    tUsd += amount * (1 - Math.max(pc, d));
    casheaOff += Math.round(amount * ((cashea?.pct || 0) / 100) * 100) / 100;
  }
  const eff = (t, base) => (total > 0 ? Math.min(0.99, Math.max(0, 1 - t / total)) : base);
  return {
    d: eff(tUsd, d), dv: eff(tVes, dv), casheaOff, perLine,
    rows: [...rows.values()].sort((a, b) => Math.max(b.cash, b.cashea) - Math.max(a.cash, a.cashea)),
  };
}
