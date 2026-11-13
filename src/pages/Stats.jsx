import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import {
  fetchOrdersForStats, fetchProducts, fetchExpenses, fetchExpenseCategories, fetchReceivablePayments,
} from '../lib/api';
import { usd, bs } from '../lib/calc';
import './finance.css';
import './stats.css';

// ============================================================
// Período
// ============================================================

const DAY = 864e5;
const pad = (n) => String(n).padStart(2, '0');
const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a, b) => Math.round((startOf(b) - startOf(a)) / DAY) + 1;   // inclusive
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const PRESETS = [
  ['today', 'Hoy'], ['7d', '7 días'], ['30d', '30 días'], ['month', 'Este mes'],
  ['lastmonth', 'Mes anterior'], ['all', 'Todo'], ['custom', 'Personalizado'],
];

const fmtShort = new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short' });
const fmtLong = new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat('es-VE', { month: 'short', year: '2-digit' });
const clean = (s) => s.replace(/\./g, '');

function rangeLabel(from, to) {
  if (!from) return `Hasta el ${clean(fmtLong.format(to))}`;
  if (localISO(from) === localISO(to)) return clean(fmtLong.format(to));
  const sameYear = from.getFullYear() === to.getFullYear();
  return `${clean((sameYear ? fmtShort : fmtLong).format(from))} – ${clean(fmtLong.format(to))}`;
}

// Período elegido → { from, to, prev, vs }. Fechas locales, días completos.
// prev es el período anterior del mismo largo (para comparar), o null.
function resolveRange(preset, desde, hasta) {
  const now = new Date();
  const today = startOf(now);
  const span = (from, to, vs) => {
    const n = daysBetween(from, to);
    return { from, to: endOf(to), prev: { from: addDays(from, -n), to: endOf(addDays(from, -1)) }, vs };
  };
  if (preset === 'today') return span(today, today, 'vs. ayer');
  if (preset === '7d') return span(addDays(today, -6), today, 'vs. 7 días anteriores');
  if (preset === '30d') return span(addDays(today, -29), today, 'vs. 30 días anteriores');
  if (preset === 'month') {
    // Mismo corte del mes anterior: 1–13 nov contra 1–13 oct.
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const pFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const pLast = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const pTo = new Date(pFrom.getFullYear(), pFrom.getMonth(), Math.min(now.getDate(), pLast));
    return { from, to: endOf(today), prev: { from: pFrom, to: endOf(pTo) }, vs: 'vs. mes anterior' };
  }
  if (preset === 'lastmonth') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    const pFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const pTo = new Date(now.getFullYear(), now.getMonth() - 1, 0);
    return { from, to: endOf(to), prev: { from: pFrom, to: endOf(pTo) }, vs: 'vs. el mes previo' };
  }
  if (preset === 'custom' && ISO_RE.test(desde || '') && ISO_RE.test(hasta || '')) {
    let a = parseISO(desde); let b = parseISO(hasta);
    if (a > b) [a, b] = [b, a];
    if (b > today) b = today;
    if (a > today) a = today;
    return span(a, b, 'vs. período anterior');
  }
  return { from: null, to: endOf(today), prev: null, vs: '' };   // 'all'
}

// ============================================================
// Cálculos
// ============================================================

// Lo que necesita el resumen y la comparación con el período anterior.
function summarize(orders, costOf) {
  let gross = 0, discount = 0, credit = 0, cogs = 0, units = 0;
  let paidAtSale = 0, cashea = 0;
  for (const o of orders) {
    gross += Number(o.total_usd) || 0;
    discount += Number(o.discount_usd) || 0;
    credit += Number(o.credit_usd) || 0;
    for (const it of o.order_items || []) {
      const qty = Number(it.quantity) || 0;
      units += qty;
      cogs += costOf(it) * qty;
    }
    for (const p of o.order_payments || []) {
      if (p.kind === 'cashea') cashea += Number(p.amount_usd) || 0;
      else paidAtSale += Number(p.amount_usd) || 0;
    }
  }
  const net = gross - discount;
  const count = orders.length;
  return { gross, discount, net, credit, cogs, units, paidAtSale, cashea, count,
    grossProfit: net - cogs, avgTicket: count ? net / count : 0 };
}

// Monto con signo tipográfico: −$348,60 (no $-348,60).
const money = (n) => (n < -0.005 ? `−${usd(-n)}` : usd(n));

const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);

// Redondeo "bonito" hacia arriba para el eje del gráfico.
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

function downloadCsv(name, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Piezas
// ============================================================

// Variación contra el período anterior. higherIsBetter=false para costos.
function Delta({ cur, prev, vs, higherIsBetter = true }) {
  if (prev == null) return null;
  if (prev === 0) {
    return <span className="fin-delta none">{cur === 0 ? 'Igual' : 'Sin datos'} <span>{vs}</span></span>;
  }
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  const up = p > 0.5; const down = p < -0.5;
  const tone = !up && !down ? 'flat' : (up === higherIsBetter ? 'good' : 'bad');
  return (
    <span className={`fin-delta ${tone}`}>
      {up ? '▲' : down ? '▼' : '='} {Math.abs(p) >= 1000 ? '>999' : Math.abs(p).toFixed(0)}% <span>{vs}</span>
    </span>
  );
}

function Kpi({ label, value, sub, cur, prev, vs, higherIsBetter, tone }) {
  return (
    <div className="card fin-kpi">
      <span className="fin-kpi-label">{label}</span>
      <strong className={`fin-kpi-value${tone ? ` ${tone}` : ''}`}>{value}</strong>
      {sub && <span className="fin-kpi-sub">{sub}</span>}
      <Delta cur={cur} prev={prev} vs={vs} higherIsBetter={higherIsBetter} />
    </div>
  );
}

// Columnas de ventas por hora, día o mes, según el largo del período.
function SalesChart({ buckets }) {
  const [hover, setHover] = useState(null);
  const max = niceMax(Math.max(0, ...buckets.map((b) => b.value)));
  const every = Math.max(1, Math.ceil(buckets.length / 8));
  const hb = hover != null ? buckets[hover] : null;
  return (
    <div className="st-chart" onMouseLeave={() => setHover(null)}>
      <div className="st-chart-plot">
        <div className="st-chart-grid" aria-hidden="true">
          {[1, 0.5, 0].map((f) => (
            <div className="st-chart-line" key={f} style={{ bottom: `${f * 100}%` }}>
              <span>{usd(max * f).replace(/,00$/, '')}</span>
            </div>
          ))}
        </div>
        <div className="st-chart-bars" role="list">
          {buckets.map((b, i) => (
            <div key={b.key} role="listitem" className={`st-bar${hover === i ? ' on' : ''}`}
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              tabIndex={0} aria-label={`${b.long}: ${usd(b.value)}, ${b.count} ventas`}>
              <span className="st-bar-fill" style={{ height: b.value > 0 ? `max(2px, ${(b.value / max) * 100}%)` : 0 }} />
            </div>
          ))}
        </div>
        {hb && (
          <div className={`st-tip ${(hover + 0.5) / buckets.length > 0.5 ? 'to-left' : 'to-right'}`}
            style={{ left: `${((hover + 0.5) / buckets.length) * 100}%` }}>
            <span className="st-tip-title">{hb.long}</span>
            <strong>{usd(hb.value)}</strong>
            <span className="muted">{hb.count === 1 ? '1 venta' : `${hb.count} ventas`}</span>
          </div>
        )}
      </div>
      <div className="st-chart-x" aria-hidden="true">
        {buckets.map((b, i) => (
          <span key={b.key}>{i % every === 0 ? b.short : ''}</span>
        ))}
      </div>
    </div>
  );
}

function Empty({ title, children }) {
  return (
    <div className="fin-empty">
      <p className="fin-empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

const TABS = [['resumen', 'Resumen'], ['ventas', 'Ventas'], ['inventario', 'Inventario'], ['utilidad', 'Utilidad']];

// ============================================================
// Página
// ============================================================

export default function Stats() {
  const { capabilities = {}, permissions = {}, isBusinessAdmin } = useAuth();
  const { allBranches } = useBranch();
  const canExpenses = !!capabilities.expenses && (isBusinessAdmin || !!permissions.expenses);
  const canAccounts = !!capabilities.accounts && (isBusinessAdmin || !!permissions.accounts);

  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'resumen';
  const preset = PRESETS.some(([k]) => k === params.get('p')) ? params.get('p') : '30d';
  const desde = params.get('desde') || '';
  const hasta = params.get('hasta') || '';
  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
  };

  const range = useMemo(() => resolveRange(preset, desde, hasta), [preset, desde, hasta]);
  const rangeKey = `${range.from?.getTime()}|${range.to.getTime()}`;

  const [branchFilter, setBranchFilter] = useState('all');
  const [data, setData] = useState(null);   // { orders, prevOrders, expenses, collections }
  const [allProducts, setAllProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    const { from, to, prev } = range;
    const iso = (d) => d?.toISOString();
    Promise.all([
      fetchOrdersForStats(iso(from), iso(to)),
      prev ? fetchOrdersForStats(iso(prev.from), iso(prev.to)) : Promise.resolve(null),
      canExpenses
        ? fetchExpenses(prev ? localISO(prev.from) : from ? localISO(from) : null, localISO(to)).catch(() => [])
        : Promise.resolve([]),
      canAccounts ? fetchReceivablePayments(iso(from), iso(to)).catch(() => null) : Promise.resolve(null),
    ]).then(([orders, prevOrders, expenses, collections]) => {
      if (alive) setData({ orders, prevOrders, expenses, collections });
    }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, canExpenses, canAccounts]);

  useEffect(() => {
    fetchProducts().then(setAllProducts).catch(() => {});
    if (canExpenses) fetchExpenseCategories().then(setCategories).catch(() => {});
  }, [canExpenses]);

  // Costo unitario de una línea: el congelado al vender o, para ventas viejas,
  // el costo actual de la variante/producto.
  const costOf = useMemo(() => {
    const productCost = new Map();
    const variantCost = new Map();
    for (const p of allProducts) {
      productCost.set(p.id, Number(p.cost) || 0);
      for (const v of p.product_variants || []) {
        variantCost.set(v.id, v.cost != null ? Number(v.cost) : (Number(p.cost) || 0));
      }
    }
    return (it) => (it.unit_cost_usd != null
      ? Number(it.unit_cost_usd) || 0
      : (variantCost.get(it.variant_id) ?? productCost.get(it.product_id) ?? 0));
  }, [allProducts]);

  const stats = useMemo(() => {
    if (!data) return null;
    const inBranch = (b) => branchFilter === 'all' || b === branchFilter;
    const orders = data.orders.filter((o) => inBranch(o.branch_id));
    const prevOrders = data.prevOrders ? data.prevOrders.filter((o) => inBranch(o.branch_id)) : null;
    const cur = summarize(orders, costOf);
    const prev = prevOrders ? summarize(prevOrders, costOf) : null;

    // ---- Gastos (por fecha del gasto, pagados y por pagar) ----
    const fromDay = range.from ? localISO(range.from) : '';
    const toDay = localISO(range.to);
    const pFromDay = range.prev ? localISO(range.prev.from) : '';
    const pToDay = range.prev ? localISO(range.prev.to) : '';
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const exp = { fixed: 0, variable: 0, pending: 0, byCat: new Map() };
    const pexp = { fixed: 0, variable: 0 };
    for (const e of data.expenses || []) {
      if (!inBranch(e.branch_id)) continue;
      const amt = Number(e.amount_usd) || 0;
      const kind = e.kind === 'fixed' ? 'fixed' : 'variable';
      if (e.spent_on >= fromDay && e.spent_on <= toDay) {
        exp[kind] += amt;
        if (e.status === 'pending') exp.pending += amt;
        const c = catName.get(e.category_id) || 'Sin categoría';
        exp.byCat.set(c, (exp.byCat.get(c) || 0) + amt);
      } else if (range.prev && e.spent_on >= pFromDay && e.spent_on <= pToDay) {
        pexp[kind] += amt;
      }
    }
    const expTotal = exp.fixed + exp.variable;
    const netProfit = cur.grossProfit - expTotal;
    const prevNetProfit = prev ? prev.grossProfit - pexp.fixed - pexp.variable : null;

    // ---- Productos ----
    const byProduct = new Map();      // clave → { name, productId, qty, revenue, cost }
    const productDays = new Map();    // nombre → Map(día → qty)
    const byMethod = new Map();
    const byAccount = new Map();
    let receivedVes = 0, receivedUsd = 0, receivedTotal = 0;
    const noCost = new Set();
    for (const o of orders) {
      const day = localISO(new Date(o.created_at));
      for (const it of o.order_items || []) {
        const qty = Number(it.quantity) || 0;
        const unitCost = costOf(it);
        if (unitCost <= 0 && qty > 0) noCost.add(it.name);
        const key = it.product_id || it.name;
        const cur2 = byProduct.get(key) || { name: it.name, productId: it.product_id, qty: 0, revenue: 0, cost: 0 };
        cur2.qty += qty;
        cur2.revenue += Number(it.line_total_usd) || 0;
        cur2.cost += unitCost * qty;
        byProduct.set(key, cur2);
        if (!productDays.has(it.name)) productDays.set(it.name, new Map());
        const pd = productDays.get(it.name);
        pd.set(day, (pd.get(day) || 0) + qty);
      }
      for (const p of o.order_payments || []) {
        const amt = Number(p.amount_usd) || 0;
        const acct = p.account_name || p.method_name || 'Sin cuenta';
        const label = p.method_name ? `${acct} · ${p.method_name}` : acct;
        byMethod.set(label, (byMethod.get(label) || 0) + amt);
        byAccount.set(acct, (byAccount.get(acct) || 0) + amt);
        receivedTotal += amt;
        if (p.currency === 'USD') receivedUsd += Number(p.amount) || 0;
        else receivedVes += Number(p.amount) || 0;
      }
    }
    const topProducts = [...byProduct.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);

    // ---- Inventario: stock, valor y días restantes al ritmo del período ----
    const stockOf = (v) => {
      if (branchFilter === 'all') {
        return (v.variant_stock || []).length
          ? v.variant_stock.reduce((s, x) => s + (Number(x.stock) || 0), 0)
          : Number(v.stock) || 0;
      }
      const row = (v.variant_stock || []).find((x) => x.branch_id === branchFilter);
      return row ? Number(row.stock) || 0 : 0;
    };
    const firstSale = orders.reduce((m, o) => (!m || o.created_at < m ? o.created_at : m), null);
    const periodDays = range.from
      ? daysBetween(range.from, range.to)
      : firstSale ? daysBetween(new Date(firstSale), range.to) : 1;
    const soldById = new Map();
    for (const p of byProduct.values()) if (p.productId) soldById.set(p.productId, p.qty);
    let invCost = 0, invPrice = 0, invUnits = 0, invNoCost = 0;
    const runway = [];
    const noSales = [];
    for (const p of allProducts) {
      const variants = (p.product_variants || []).filter((v) => v.active !== false);
      const list = variants.length ? variants : [{ stock: p.stock, price: null, cost: null }];
      let stock = 0;
      for (const v of list) {
        const s = Math.max(0, stockOf(v));
        stock += s;
        const c = v.cost != null ? Number(v.cost) : Number(p.cost) || 0;
        const pr = v.price != null ? Number(v.price) : Number(p.price) || 0;
        invCost += s * c; invPrice += s * pr; invUnits += s;
        if (s > 0 && c <= 0) invNoCost += 1;
      }
      const sold = soldById.get(p.id) || 0;
      if (sold > 0) {
        const perDay = sold / periodDays;
        const daysLeft = stock / perDay;
        runway.push({ id: p.id, name: p.name, stock, perDay, daysLeft });
      } else {
        noSales.push({ id: p.id, name: p.name, stock });
      }
    }
    runway.sort((a, b) => a.daysLeft - b.daysLeft);
    noSales.sort((a, b) => b.stock - a.stock || a.name.localeCompare(b.name));

    // ---- Serie de ventas: por hora (1 día), día (≤ 62), semana (≤ 182) o mes ----
    // Cada modo define sus casillas y en cuál cae una venta.
    const buckets = [];
    const first = range.from ? startOf(range.from) : startOf(new Date(firstSale || range.to));
    const monthLong = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric' });
    let slotOf;
    if (range.from && periodDays === 1) {
      for (let h = 0; h < 24; h++) {
        buckets.push({ key: h, short: `${h}h`, long: `${clean(fmtShort.format(first))}, ${pad(h)}:00–${pad(h)}:59` });
      }
      slotOf = (d) => d.getHours();
    } else if (periodDays <= 62) {
      for (let d = first; d <= range.to; d = addDays(d, 1)) {
        buckets.push({ key: localISO(d), short: String(d.getDate()), long: clean(fmtLong.format(d)) });
      }
      slotOf = (d) => daysBetween(first, d) - 1;
    } else if (periodDays <= 182) {
      for (let d = first; d <= range.to; d = addDays(d, 7)) {
        const e = addDays(d, 6) > range.to ? startOf(range.to) : addDays(d, 6);
        buckets.push({ key: localISO(d), short: clean(fmtShort.format(d)), long: rangeLabel(d, e) });
      }
      slotOf = (d) => Math.floor((daysBetween(first, d) - 1) / 7);
    } else {
      for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d <= range.to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        buckets.push({ key: localISO(d), short: clean(fmtMonth.format(d)), long: clean(monthLong.format(d)) });
      }
      slotOf = (d) => (d.getFullYear() - first.getFullYear()) * 12 + d.getMonth() - first.getMonth();
    }
    for (const b of buckets) { b.value = 0; b.count = 0; }
    for (const o of orders) {
      const b = buckets[slotOf(new Date(o.created_at))];
      if (b) { b.value += (Number(o.total_usd) || 0) - (Number(o.discount_usd) || 0); b.count += 1; }
    }

    const collected = data.collections
      ? data.collections.filter((c) => inBranch(c.debts?.branch_id)).reduce((s, c) => s + (Number(c.amount_usd) || 0), 0)
      : null;

    return {
      cur, prev, exp, pexp, expTotal, netProfit, prevNetProfit,
      topProducts, productDays, noCost: [...noCost].sort((a, b) => a.localeCompare(b)),
      methods: [...byMethod.entries()].map(([name, v]) => ({ name, usd: v })).sort((a, b) => b.usd - a.usd),
      accounts: [...byAccount.entries()].map(([name, v]) => ({ name, usd: v })).sort((a, b) => b.usd - a.usd),
      receivedVes, receivedUsd, receivedTotal,
      expByCat: [...exp.byCat.entries()].map(([name, v]) => ({ name, usd: v })).sort((a, b) => b.usd - a.usd),
      invCost, invPrice, invUnits, invNoCost, runway, noSales, periodDays,
      buckets, collected,
    };
  }, [data, costOf, allProducts, categories, branchFilter, range]);

  // ---------- Exportar lo que se ve en la pestaña ----------
  function exportCsv() {
    if (!stats) return;
    const tag = range.from ? `${localISO(range.from)}_${localISO(range.to)}` : `hasta_${localISO(range.to)}`;
    const f2 = (n) => n.toFixed(2);
    if (tab === 'ventas') {
      const rows = [['Producto', 'Cantidad', 'Ingresos USD', 'Costo USD', 'Utilidad USD']];
      stats.topProducts.forEach((p) => rows.push([p.name, p.qty, f2(p.revenue), f2(p.cost), f2(p.revenue - p.cost)]));
      downloadCsv(`ventas-${tag}.csv`, rows);
    } else if (tab === 'inventario') {
      const rows = [['Producto', 'Stock', 'Vendido por día', 'Días restantes']];
      stats.runway.forEach((r) => rows.push([r.name, r.stock, r.perDay.toFixed(2), Number.isFinite(r.daysLeft) ? r.daysLeft.toFixed(0) : '']));
      stats.noSales.forEach((r) => rows.push([r.name, r.stock, 0, 'Sin ventas']));
      downloadCsv(`inventario-${tag}.csv`, rows);
    } else if (tab === 'utilidad') {
      const { cur } = stats;
      const rows = [['Concepto', 'USD'],
        ['Ventas a precio de lista', f2(cur.gross)], ['Descuentos', f2(-cur.discount)], ['Ventas netas', f2(cur.net)],
        ['Costo de lo vendido', f2(-cur.cogs)], ['Utilidad bruta', f2(cur.grossProfit)]];
      if (canExpenses) {
        rows.push(['Gastos fijos', f2(-stats.exp.fixed)], ['Gastos variables', f2(-stats.exp.variable)], ['Utilidad neta', f2(stats.netProfit)]);
      }
      downloadCsv(`utilidad-${tag}.csv`, rows);
    } else {
      const rows = [['Período', 'Ventas netas USD', 'Ventas']];
      stats.buckets.forEach((b) => rows.push([b.long, f2(b.value), b.count]));
      downloadCsv(`resumen-${tag}.csv`, rows);
    }
  }

  function pickPreset(key) {
    if (key === 'custom') {
      const a = range.from ? localISO(range.from) : localISO(addDays(new Date(), -29));
      setParam({ p: 'custom', desde: desde || a, hasta: hasta || localISO(new Date()) });
    } else {
      setParam({ p: key, desde: '', hasta: '' });
    }
  }

  const todayIso = localISO(new Date());
  const vs = range.vs;
  const P = stats?.prev;   // período anterior (o null)

  return (
    <div className="page fin-page st-page">
      <header className="page-head">
        <div>
          <h1>Estadísticas</h1>
          <p className="page-sub">Cómo van las ventas, el inventario y la utilidad del negocio.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn ghost" onClick={exportCsv} disabled={!stats}>Exportar</button>
        </div>
      </header>

      {/* ---------- Período (vale para todas las pestañas) ---------- */}
      <div className="st-filters">
        <div className="st-presets" role="group" aria-label="Período">
          {PRESETS.map(([key, label]) => (
            <button key={key} type="button" className={`chip-btn${preset === key ? ' active' : ''}`}
              aria-pressed={preset === key} onClick={() => pickPreset(key)}>
              {label}
            </button>
          ))}
        </div>
        {allBranches.length > 1 && (
          <select className="fin-select" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="all">Todas las sucursales</option>
            {allBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>
      <div className="st-range">
        {preset === 'custom' ? (
          <div className="st-dates">
            <label>
              <span>Desde</span>
              <input type="date" value={desde} max={hasta || todayIso}
                onChange={(e) => e.target.value && setParam({ desde: e.target.value })} />
            </label>
            <span className="st-dates-sep" aria-hidden="true">–</span>
            <label>
              <span>Hasta</span>
              <input type="date" value={hasta} min={desde} max={todayIso}
                onChange={(e) => e.target.value && setParam({ hasta: e.target.value })} />
            </label>
          </div>
        ) : (
          <strong className="st-range-label">{rangeLabel(range.from, range.to)}</strong>
        )}
        {range.from && (
          <span className="muted">
            {daysBetween(range.from, range.to) === 1 ? '1 día' : `${daysBetween(range.from, range.to)} días`}
            {range.prev && ` · se compara con ${rangeLabel(range.prev.from, range.prev.to)}`}
          </span>
        )}
      </div>

      <div className="fin-tabs-row">
        <div className="fin-tabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k}
              className={`fin-tab${tab === k ? ' active' : ''}`}
              onClick={() => setParam({ tab: k === 'resumen' ? '' : k })}>
              {label}
              {k === 'inventario' && stats && stats.runway.filter((r) => r.daysLeft <= 7).length > 0 && (
                <span className="fin-tab-count alert">{stats.runway.filter((r) => r.daysLeft <= 7).length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {!stats ? (
        <div className="card"><div className="fin-empty"><span className="muted">Cargando…</span></div></div>
      ) : tab === 'resumen' ? (
        <>
          <div className="fin-kpis">
            <Kpi label="Ventas netas" value={usd(stats.cur.net)} sub={stats.cur.discount > 0.005 ? `Descuentos ${usd(stats.cur.discount)}` : null}
              cur={stats.cur.net} prev={P?.net} vs={vs} />
            {canExpenses ? (
              <Kpi label="Utilidad neta" value={money(stats.netProfit)} tone={stats.netProfit < 0 ? 'late' : ''}
                sub={`Margen ${pct(stats.netProfit, stats.cur.net).toFixed(0)}% · después de gastos`}
                cur={stats.netProfit} prev={stats.prevNetProfit} vs={vs} />
            ) : (
              <Kpi label="Utilidad bruta" value={money(stats.cur.grossProfit)}
                sub={`Margen ${pct(stats.cur.grossProfit, stats.cur.net).toFixed(0)}% · antes de gastos`}
                cur={stats.cur.grossProfit} prev={P?.grossProfit} vs={vs} />
            )}
            <Kpi label="Ventas" value={stats.cur.count} sub={`${stats.cur.units} productos vendidos`}
              cur={stats.cur.count} prev={P?.count} vs={vs} />
            <Kpi label="Ticket promedio" value={usd(stats.cur.avgTicket)}
              cur={stats.cur.avgTicket} prev={P?.avgTicket} vs={vs} />
          </div>

          <div className="stats-cols">
            <section className="card vsection">
              <div className="st-sec-head">
                <h2>Ventas netas</h2>
                <span className="muted">
                  {stats.periodDays === 1 && range.from ? 'Por hora' : stats.periodDays > 182 ? 'Por mes' : stats.periodDays > 62 ? 'Por semana' : 'Por día'}
                </span>
              </div>
              {stats.cur.count === 0
                ? <Empty title="Sin ventas en este período">Regístralas en <Link to="/orders">Ventas</Link>.</Empty>
                : <SalesChart buckets={stats.buckets} />}
            </section>

            <div className="stats-side">
              <section className="card vsection">
                <h2>Cómo se cobró</h2>
                <div className="totals">
                  <div className="totals-row"><span>Cobrado al vender</span><span>{usd(stats.cur.paidAtSale)}</span></div>
                  {stats.cur.cashea > 0.005 && (
                    <div className="totals-row"><span>Financiado por Cashea</span><span>{usd(stats.cur.cashea)}</span></div>
                  )}
                  <div className="totals-row"><span>Vendido a crédito</span><span>{usd(stats.cur.credit)}</span></div>
                  <div className="totals-row grand"><span>Ventas netas</span><span>{usd(stats.cur.net)}</span></div>
                  {stats.collected != null && (
                    <div className="totals-row st-row-top">
                      <span>Cobros de créditos <span className="muted">(abonos del período)</span></span>
                      <span>{usd(stats.collected)}</span>
                    </div>
                  )}
                </div>
                {stats.cur.credit > 0.005 && canAccounts && (
                  <p className="hint">Lo vendido a crédito está en <Link to="/accounts">Cuentas por cobrar</Link>.</p>
                )}
              </section>

              {(stats.noCost.length > 0 || stats.runway.some((r) => r.daysLeft <= 7)) && (
                <section className="card vsection">
                  <h2>Para revisar</h2>
                  <div className="st-alerts">
                    {stats.runway.some((r) => r.daysLeft <= 7) && (
                      <button type="button" className="st-alert" onClick={() => setParam({ tab: 'inventario' })}>
                        <i className="fin-dot late" />
                        <span><strong>{(() => { const n = stats.runway.filter((r) => r.daysLeft <= 7).length; return n === 1 ? '1 producto por agotarse' : `${n} productos por agotarse`; })()}</strong> en una semana o menos al ritmo actual</span>
                      </button>
                    )}
                    {stats.noCost.length > 0 && (
                      <button type="button" className="st-alert" onClick={() => setParam({ tab: 'utilidad' })}>
                        <i className="fin-dot soon" />
                        <span><strong>{stats.noCost.length === 1 ? '1 producto vendido sin costo' : `${stats.noCost.length} productos vendidos sin costo`}</strong>: la utilidad sale más alta de lo real</span>
                      </button>
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
        </>
      ) : tab === 'ventas' ? (
        <>
          <div className="fin-kpis">
            <Kpi label="Productos vendidos" value={stats.cur.units} cur={stats.cur.units} prev={P?.units} vs={vs} />
            <Kpi label="Productos distintos" value={stats.topProducts.length} />
            <Kpi label="Descuentos concedidos" value={usd(stats.cur.discount)} sub={`${pct(stats.cur.discount, stats.cur.gross).toFixed(1)}% de la venta a precio de lista`} />
            <Kpi label="Ventas a crédito" value={usd(stats.cur.credit)} cur={stats.cur.credit} prev={P?.credit} vs={vs} higherIsBetter={false} />
          </div>
          {stats.cur.count === 0 ? (
            <div className="card"><Empty title="Sin ventas en este período">Regístralas en <Link to="/orders">Ventas</Link>.</Empty></div>
          ) : (
            <div className="stats-cols">
              <section className="card vsection">
                <h2>Más vendidos</h2>
                <div className="rank">
                  {stats.topProducts.slice(0, 10).map((p) => (
                    <button className="rank-row rank-click" key={p.productId || p.name} onClick={() => setDetail(p.name)}>
                      <div className="rank-info">
                        <span className="rank-name">{p.name}</span>
                        <span className="muted">
                          {p.qty} und · {usd(p.revenue)}
                          {p.cost > 0 && ` · utilidad ${usd(p.revenue - p.cost)}`}
                        </span>
                      </div>
                      <div className="rank-bar"><span style={{ width: `${(p.qty / (stats.topProducts[0]?.qty || 1)) * 100}%` }} /></div>
                    </button>
                  ))}
                </div>
                <p className="hint">Toca un producto para ver sus ventas día a día.</p>
                {stats.topProducts.length > 10 && (
                  <>
                    <h3 className="rank-subtitle">Menos vendidos</h3>
                    <div className="rank compact">
                      {[...stats.topProducts].reverse().slice(0, 5).map((p) => (
                        <div className="rank-row" key={p.productId || p.name}>
                          <div className="rank-info">
                            <span className="rank-name">{p.name}</span>
                            <span className="muted">{p.qty} und · {usd(p.revenue)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>

              <div className="stats-side">
                <section className="card vsection">
                  <h2>Por moneda</h2>
                  <p className="hint">Lo que entró al vender, en la moneda en que se pagó.</p>
                  <div className="totals">
                    <div className="totals-row"><span>En bolívares</span><span>{bs(stats.receivedVes)}</span></div>
                    <div className="totals-row"><span>En divisa</span><span>{usd(stats.receivedUsd)}</span></div>
                    <div className="totals-row grand"><span>Total en USD</span><span>{usd(stats.receivedTotal)}</span></div>
                  </div>
                </section>
                <section className="card vsection">
                  <h2>Por cuenta</h2>
                  <div className="totals">
                    {stats.accounts.map((a) => (
                      <div className="totals-row" key={a.name}><span>{a.name}</span><span>{usd(a.usd)}</span></div>
                    ))}
                  </div>
                </section>
                <section className="card vsection">
                  <h2>Por método de pago</h2>
                  <div className="totals">
                    {stats.methods.map((m) => (
                      <div className="totals-row" key={m.name}><span>{m.name}</span><span>{usd(m.usd)}</span></div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}
        </>
      ) : tab === 'inventario' ? (
        <>
          <div className="fin-kpis">
            <Kpi label="Valor al costo" value={usd(stats.invCost)}
              sub={stats.invNoCost > 0 ? stats.invNoCost === 1 ? "1 artículo sin costo registrado" : `${stats.invNoCost} artículos sin costo registrado` : 'Lo que pagaste por lo que tienes'} />
            <Kpi label="Valor a precio de venta" value={usd(stats.invPrice)}
              sub={stats.invPrice > stats.invCost ? `Ganancia potencial ${usd(stats.invPrice - stats.invCost)}` : null} />
            <Kpi label="Unidades en stock" value={Math.round(stats.invUnits)} />
            <Kpi label="Por agotarse" value={stats.runway.filter((r) => r.daysLeft <= 7).length}
              tone={stats.runway.some((r) => r.daysLeft <= 7) ? 'late' : ''} sub="En 7 días o menos" />
          </div>
          <div className="stats-cols">
            <section className="card vsection">
              <h2>Días de inventario</h2>
              <p className="hint">
                Cuántos días te dura el stock al ritmo de venta del período
                ({stats.periodDays === 1 ? '1 día' : `${stats.periodDays} días`}). Con 30 días la estimación es más estable.
              </p>
              {stats.runway.length === 0 ? (
                <Empty title="Sin ventas en este período">Cuando vendas, aquí verás cuánto te dura cada producto.</Empty>
              ) : (
                <div className="st-runway" role="table">
                  <div className="st-runway-row st-runway-head" role="row">
                    <span role="columnheader">Producto</span>
                    <span role="columnheader">Stock</span>
                    <span role="columnheader">Vende/día</span>
                    <span role="columnheader">Le quedan</span>
                  </div>
                  {stats.runway.slice(0, 15).map((r) => {
                    const lvl = r.daysLeft <= 7 ? 'late' : r.daysLeft <= 21 ? 'soon' : 'ok';
                    return (
                      <div className="st-runway-row" role="row" key={r.id}>
                        <span className="st-runway-name" role="cell">{r.name}</span>
                        <span role="cell">{Math.round(r.stock)}</span>
                        <span role="cell">{r.perDay >= 10 ? r.perDay.toFixed(0) : r.perDay.toFixed(1)}</span>
                        <span role="cell" className={`st-pill ${lvl}`}>
                          {r.stock <= 0 ? 'Agotado' : r.daysLeft < 1 ? 'Menos de 1 día' : `${Math.round(r.daysLeft)} días`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            <section className="card vsection">
              <h2>Sin ventas en el período</h2>
              <p className="hint">Productos del catálogo que no se vendieron. Los que tienen más stock van primero.</p>
              {stats.noSales.length === 0 ? (
                <Empty title="Todo se movió">Cada producto tuvo al menos una venta.</Empty>
              ) : (
                <div className="totals">
                  {stats.noSales.slice(0, 15).map((p) => (
                    <div className="totals-row" key={p.id}>
                      <span>{p.name}</span><span className="muted">{Math.round(p.stock)} en stock</span>
                    </div>
                  ))}
                  {stats.noSales.length > 15 && <p className="hint">y {stats.noSales.length - 15} más.</p>}
                </div>
              )}
            </section>
          </div>
        </>
      ) : (
        /* ---------- Utilidad ---------- */
        <div className="stats-cols">
          <section className="card vsection">
            <h2>Estado de resultados</h2>
            <div className="st-pl" role="table">
              <div className="st-pl-row st-pl-head" role="row">
                <span role="columnheader" />
                <span role="columnheader">Actual</span>
                {P && <span role="columnheader">Anterior</span>}
              </div>
              {[
                ['Ventas a precio de lista', stats.cur.gross, P?.gross],
                ['Descuentos', -stats.cur.discount, P && -P.discount],
                ['Ventas netas', stats.cur.net, P?.net, 'sub'],
                ['Costo de lo vendido', -stats.cur.cogs, P && -P.cogs],
                ['Utilidad bruta', stats.cur.grossProfit, P?.grossProfit, 'sub', pct(stats.cur.grossProfit, stats.cur.net)],
                ...(canExpenses ? [
                  ['Gastos fijos', -stats.exp.fixed, P && -stats.pexp.fixed],
                  ['Gastos variables', -stats.exp.variable, P && -stats.pexp.variable],
                  ['Utilidad neta', stats.netProfit, stats.prevNetProfit, 'grand', pct(stats.netProfit, stats.cur.net)],
                ] : []),
              ].map(([label, v, pv, kind, margin]) => (
                <div className={`st-pl-row${kind ? ` ${kind}` : ''}`} role="row" key={label}>
                  <span role="cell">
                    {label}
                    {margin != null && stats.cur.net > 0 && <span className="st-pl-margin">Margen {margin.toFixed(1)}%</span>}
                  </span>
                  <span role="cell" className={v < -0.005 && kind ? 'neg' : ''}>{money(v)}</span>
                  {P && <span role="cell" className="muted">{pv == null ? '—' : money(pv)}</span>}
                </div>
              ))}
            </div>
            {!canExpenses && (
              <p className="hint">Para ver la utilidad neta (después de gastos) necesitas el permiso de Gastos.</p>
            )}
            {canExpenses && stats.exp.pending > 0.005 && (
              <p className="hint">Incluye {usd(stats.exp.pending)} en gastos aún por pagar.</p>
            )}
            {stats.noCost.length > 0 && (
              <div className="nocost-warn">
                ⚠ {stats.noCost.length === 1 ? '1 producto vendido sin costo registrado' : `${stats.noCost.length} productos vendidos sin costo registrado`}
                ; la utilidad sale más alta de lo real. Regístralo en <Link to="/inventory">Inventario</Link>.
                <span className="muted"> {stats.noCost.slice(0, 6).join(' · ')}{stats.noCost.length > 6 ? '…' : ''}</span>
              </div>
            )}
            <p className="hint">
              Las ventas cuentan cuando se hacen, aunque sean a crédito. El costo es el que tenía el producto al venderse.
              Los gastos cuentan por su fecha.
            </p>
          </section>

          {canExpenses && (
            <section className="card vsection">
              <div className="st-sec-head">
                <h2>Gastos por categoría</h2>
                <Link to="/expenses" className="st-link">Ver gastos</Link>
              </div>
              {stats.expByCat.length === 0 ? (
                <Empty title="Sin gastos en este período" />
              ) : (
                <div className="rank">
                  {stats.expByCat.map((c) => (
                    <div className="rank-row" key={c.name}>
                      <div className="rank-info">
                        <span className="rank-name">{c.name}</span>
                        <span className="muted">{usd(c.usd)} · {pct(c.usd, stats.expTotal).toFixed(0)}%</span>
                      </div>
                      <div className="rank-bar"><span style={{ width: `${(c.usd / stats.expByCat[0].usd) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* -------- Tendencia de un producto -------- */}
      {detail && stats && (() => {
        const days = [...(stats.productDays.get(detail) || new Map()).entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const max = Math.max(1, ...days.map(([, v]) => v));
        const total = days.reduce((s, [, v]) => s + v, 0);
        return (
          <div className="modal-backdrop" onClick={() => setDetail(null)}>
            <div className="modal card" onClick={(e) => e.stopPropagation()}>
              <div className="pos-panel-head">
                <h2>{detail}</h2>
                <button className="btn ghost sm" onClick={() => setDetail(null)}>Cerrar</button>
              </div>
              <p className="page-sub">{total} unidades vendidas en el período.</p>
              <div className="rank compact">
                {days.map(([day, v]) => (
                  <div className="rank-row" key={day}>
                    <div className="rank-info">
                      <span className="rank-name">{clean(fmtLong.format(parseISO(day)))}</span>
                      <span className="muted">{v} und</span>
                    </div>
                    <div className="rank-bar"><span style={{ width: `${(v / max) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
