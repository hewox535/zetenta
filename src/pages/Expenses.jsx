import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { useConfirm } from '../components/Confirm';
import { FinModal, RowMenu, Toast, SortHead } from '../components/FinUI';
import { notifyCashChanged } from '../lib/cashEvents';
import {
  fetchExpenses, createExpense, updateExpense, deleteExpense,
  fetchExpenseCategories, createExpenseCategory,
  fetchRecurringExpenses, createRecurringExpense, updateRecurringExpense, deleteRecurringExpense,
  uploadExpenseReceipt, expenseReceiptUrl, fetchBankAccounts, fetchSuppliers, fetchSalesTotal,
} from '../lib/api';
import { fetchBcvRates, resolveRate } from '../lib/rates';
import { usd, bs, formatDate } from '../lib/calc';
import { num, round2, localISO, addDays, dueInfo, downloadCsv, norm } from '../lib/finance';
import './finance.css';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const FREQ = [['weekly', 'Semanal'], ['biweekly', 'Quincenal'], ['monthly', 'Mensual'], ['quarterly', 'Trimestral'], ['yearly', 'Anual']];
const FREQ_LABEL = Object.fromEntries(FREQ);
const KINDS = [['all', 'Todos'], ['variable', 'Variables'], ['fixed', 'Fijos'], ['pending', 'Por pagar']];
const PENDING = '__pending__';

function nextDue(iso, freq) {
  if (freq === 'weekly') return addDays(iso, 7);
  if (freq === 'biweekly') return addDays(iso, 14);
  const [y, m, d] = iso.split('-').map(Number);
  const add = freq === 'quarterly' ? 3 : freq === 'yearly' ? 12 : 1;
  const last = new Date(y, m - 1 + add + 1, 0).getDate();   // el 31 cae en el último día del mes
  return localISO(new Date(y, m - 1 + add, Math.min(d, last)));
}

// [desde, hasta) del período en fechas locales.
function periodRange(p) {
  if (p.mode === 'year') return [localISO(new Date(p.y, 0, 1)), localISO(new Date(p.y + 1, 0, 1))];
  return [localISO(new Date(p.y, p.m, 1)), localISO(new Date(p.y, p.m + 1, 1))];
}
function shiftPeriod(p, dir) {
  if (p.mode === 'year') return { ...p, y: p.y + dir };
  const d = new Date(p.y, p.m + dir, 1);
  return { ...p, y: d.getFullYear(), m: d.getMonth() };
}
const periodLabel = (p) => (p.mode === 'year' ? `Año ${p.y}` : `${MONTHS[p.m]} ${p.y}`);
const toTs = (iso) => new Date(`${iso}T00:00:00`).toISOString();
const pct = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

function Delta({ cur, prev, label }) {
  const p = pct(cur, prev);
  if (p === null) return <span className="fin-delta none">— sin datos {label}</span>;
  const up = p > 0.5; const down = p < -0.5;
  return (
    <span className={`fin-delta ${up ? 'up' : down ? 'down' : 'flat'}`}>
      {up ? '▲' : down ? '▼' : '='} {Math.abs(p).toFixed(0)}% <span>{label}</span>
    </span>
  );
}

const ClipIcon = (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M8.5 12.5l5.8-5.8a2.6 2.6 0 0 1 3.7 3.7l-7.3 7.3a4.2 4.2 0 0 1-6-6l6.6-6.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
);

export default function Expenses() {
  const { business } = useAuth();
  const { branchId } = useBranch();
  const ask = useConfirm();
  const now = new Date();

  const [period, setPeriod] = useState({ mode: 'month', y: now.getFullYear(), m: now.getMonth() });
  const [tab, setTab] = useState('list');
  const [category, setCategory] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });

  const [rows, setRows] = useState(null);
  const [prev, setPrev] = useState({ all: 0, fixed: 0, variable: 0, sales: 0 });
  const [sales, setSales] = useState(null);
  const [categories, setCategories] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [rate, setRate] = useState({ value: 0 });
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editingFixed, setEditingFixed] = useState(null);

  const [from, to] = periodRange(period);
  const prevPeriod = shiftPeriod(period, -1);
  const [pFrom] = periodRange(prevPeriod);

  const load = useCallback(async () => {
    setError(null);
    try {
      const all = await fetchExpenses(pFrom, addDays(to, -1));
      const cur = all.filter((e) => e.spent_on >= from);
      const old = all.filter((e) => e.spent_on < from);
      const sum = (l) => round2(l.reduce((s, e) => s + Number(e.amount_usd), 0));
      setRows(cur);
      const [salesNow, salesPrev] = await Promise.all([
        fetchSalesTotal(toTs(from), toTs(to)).catch(() => null),
        fetchSalesTotal(toTs(pFrom), toTs(from)).catch(() => 0),
      ]);
      setSales(salesNow);
      setPrev({
        all: sum(old), fixed: sum(old.filter((e) => e.kind === 'fixed')),
        variable: sum(old.filter((e) => e.kind === 'variable')), sales: salesPrev || 0,
      });
    } catch (e) { setError(e.message); setRows([]); }
  }, [from, to, pFrom]);

  const loadRecurring = useCallback(() => fetchRecurringExpenses().then(setRecurring).catch(() => {}), []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchExpenseCategories().then(setCategories).catch(() => {});
    loadRecurring();
    fetchBankAccounts().then((a) => setAccounts(a.filter((x) => x.active))).catch(() => {});
    fetchSuppliers().then(setSuppliers).catch(() => {});
  }, [loadRecurring]);
  useEffect(() => {
    fetchBcvRates().then((r) => setRate(resolveRate(business?.rate_config, r))).catch(() => {});
  }, [business]);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  // ---------- cifras ----------
  const totals = useMemo(() => {
    const list = rows || [];
    const sum = (l) => round2(l.reduce((s, e) => s + Number(e.amount_usd), 0));
    return {
      all: sum(list), count: list.length,
      fixed: sum(list.filter((e) => e.kind === 'fixed')),
      variable: sum(list.filter((e) => e.kind === 'variable')),
      pending: sum(list.filter((e) => e.status === 'pending')),
      pendingN: list.filter((e) => e.status === 'pending').length,
    };
  }, [rows]);
  const result = sales === null ? null : round2(sales - totals.all);
  const prevResult = round2(prev.sales - prev.all);

  const filtered = useMemo(() => {
    const q = norm(search.trim());
    const dir = sort.dir === 'asc' ? 1 : -1;
    return (rows || []).filter((e) => {
      if (category && (e.category_id || 'none') !== category) return false;
      if (kindFilter === 'pending' && e.status !== 'pending') return false;
      if ((kindFilter === 'fixed' || kindFilter === 'variable') && e.kind !== kindFilter) return false;
      if (q && !norm([e.name, e.supplier_name, e.note, catName.get(e.category_id), e.account_name].join(' ')).includes(q)) return false;
      return true;
    }).sort((a, b) => {
      if (sort.key === 'name') return dir * a.name.localeCompare(b.name);
      if (sort.key === 'category') return dir * (catName.get(a.category_id) || '~').localeCompare(catName.get(b.category_id) || '~');
      if (sort.key === 'amount') return dir * (Number(a.amount_usd) - Number(b.amount_usd));
      return dir * (a.spent_on.localeCompare(b.spent_on) || a.created_at.localeCompare(b.created_at));
    });
  }, [rows, category, kindFilter, search, sort, catName]);
  const filteredTotal = round2(filtered.reduce((s, e) => s + Number(e.amount_usd), 0));

  const byCategory = useMemo(() => {
    const m = new Map();
    (rows || []).forEach((e) => {
      const k = e.category_id || 'none';
      m.set(k, round2((m.get(k) || 0) + Number(e.amount_usd)));
    });
    return [...m.entries()]
      .map(([id, total]) => ({ id, name: id === 'none' ? 'Sin categoría' : catName.get(id) || 'Categoría borrada', total }))
      .sort((a, b) => b.total - a.total);
  }, [rows, catName]);
  const maxCat = byCategory[0]?.total || 0;

  const activeFixed = recurring.filter((r) => r.active);
  const dueSoon = activeFixed.filter((r) => dueInfo(r.next_due, 5).tone !== 'ok');
  const monthlyFixed = round2(activeFixed.reduce((s, r) => {
    const usdAmt = r.currency === 'USD' ? Number(r.amount) : (rate.value ? Number(r.amount) / rate.value : 0);
    const factor = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[r.frequency] || 1;
    return s + usdAmt * factor;
  }, 0));

  // ---------- acciones ----------
  async function onDelete(e) {
    if (!await ask({
      title: '¿Borrar este gasto?',
      message: `${e.name} · ${usd(e.amount_usd)} del ${formatDate(e.spent_on)}.${e.cash_movement_id ? ' Si la caja sigue abierta, la plata vuelve a la caja.' : ''}`,
      confirmLabel: 'Borrar gasto',
    })) return;
    try { await deleteExpense(e.id); await load(); notifyCashChanged(); setToast({ text: 'Gasto borrado' }); }
    catch (err) { setError(err.message); }
  }

  async function onDeleteFixed(r) {
    if (!await ask({
      title: `¿Quitar “${r.name}” de los gastos fijos?`,
      message: 'Los pagos ya registrados se mantienen; solo deja de avisarte.',
      confirmLabel: 'Quitar',
    })) return;
    try { await deleteRecurringExpense(r.id); await loadRecurring(); setToast({ text: 'Gasto fijo quitado' }); }
    catch (err) { setError(err.message); }
  }

  async function toggleFixed(r) {
    try { await updateRecurringExpense(r.id, { active: !r.active }); await loadRecurring(); }
    catch (err) { setError(err.message); }
  }

  async function openReceipt(path) {
    try { window.open(await expenseReceiptUrl(path), '_blank', 'noopener'); }
    catch (err) { setError(err.message); }
  }

  async function onNewCategory(name) {
    const c = await createExpenseCategory(business.id, name);
    setCategories((p) => [...p, c]);
    return c;
  }

  function exportCsv() {
    const out = [['Fecha', 'Gasto', 'Tipo', 'Categoría', 'Proveedor', 'Monto', 'Moneda', 'Monto USD', 'Pagado con', 'Estado', 'Nota']];
    filtered.forEach((e) => out.push([
      formatDate(e.spent_on), e.name, e.kind === 'fixed' ? 'Fijo' : 'Variable', catName.get(e.category_id) || '',
      e.supplier_name, Number(e.amount).toFixed(2), e.currency, Number(e.amount_usd).toFixed(2),
      e.account_name, e.status === 'paid' ? 'Pagado' : 'Por pagar', e.note,
    ]));
    downloadCsv(`gastos-${from.slice(0, period.mode === 'year' ? 4 : 7)}.csv`, out);
  }

  const isCurrent = period.mode === 'year' ? period.y === now.getFullYear()
    : period.y === now.getFullYear() && period.m === now.getMonth();
  const vsLabel = period.mode === 'year' ? 'vs. año anterior' : 'vs. mes anterior';
  const filtering = category || kindFilter !== 'all' || search.trim();

  return (
    <div className="page fin-page">
      <header className="page-head">
        <div>
          <h1>Gastos</h1>
          <p className="page-sub">En qué se va la plata y cuánto te queda de lo que vendes.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn ghost" onClick={exportCsv} disabled={!filtered.length}>Exportar</button>
          <button type="button" className="btn primary" onClick={() => setForm({})}>+ Agregar gasto</button>
        </div>
      </header>

      {error && <div className="form-error" onClick={() => setError(null)}>{error}</div>}

      {dueSoon.length > 0 && (
        <div className="fin-alert">
          <span className="fin-alert-icon" aria-hidden="true">!</span>
          <span className="fin-alert-text">
            <strong>{dueSoon.length === 1 ? `${dueSoon[0].name} ${dueInfo(dueSoon[0].next_due, 5).label.toLowerCase()}` : `${dueSoon.length} gastos fijos vencen pronto`}</strong>
            {dueSoon.length > 1 && <span> · {dueSoon.slice(0, 3).map((r) => r.name).join(', ')}{dueSoon.length > 3 ? '…' : ''}</span>}
          </span>
          {dueSoon.length === 1
            ? <button type="button" className="btn sm" onClick={() => setForm({ template: dueSoon[0] })}>Registrar pago</button>
            : <button type="button" className="btn sm" onClick={() => setTab('fixed')}>Ver gastos fijos</button>}
        </div>
      )}

      <div className="fin-filters">
        <div className="fin-period">
          <button type="button" className="fin-period-btn" aria-label="Período anterior" onClick={() => setPeriod((p) => shiftPeriod(p, -1))}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <strong>{periodLabel(period)}</strong>
          <button type="button" className="fin-period-btn" aria-label="Período siguiente" disabled={isCurrent}
            onClick={() => setPeriod((p) => shiftPeriod(p, 1))}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        <div className="seg sm">
          <button type="button" className={`seg-btn${period.mode === 'month' ? ' active' : ''}`}
            onClick={() => setPeriod({ mode: 'month', y: now.getFullYear(), m: now.getMonth() })}>Mes</button>
          <button type="button" className={`seg-btn${period.mode === 'year' ? ' active' : ''}`}
            onClick={() => setPeriod({ mode: 'year', y: now.getFullYear(), m: now.getMonth() })}>Año</button>
        </div>
        {!isCurrent && (
          <button type="button" className="btn ghost sm"
            onClick={() => setPeriod((p) => ({ ...p, y: now.getFullYear(), m: now.getMonth() }))}>
            Ir a {period.mode === 'year' ? 'este año' : 'este mes'}
          </button>
        )}
      </div>

      <div className="fin-kpis">
        <div className="card fin-kpi">
          <span className="fin-kpi-label">Gastos totales</span>
          <strong className="fin-kpi-value">{usd(totals.all)}</strong>
          <Delta cur={totals.all} prev={prev.all} label={vsLabel} />
        </div>
        <button type="button" className={`card fin-kpi${kindFilter === 'fixed' ? ' active' : ''}`}
          onClick={() => { setTab('list'); setKindFilter((k) => (k === 'fixed' ? 'all' : 'fixed')); }}>
          <span className="fin-kpi-label"><i className="fin-dot fixed" />Fijos</span>
          <strong className="fin-kpi-value">{usd(totals.fixed)}</strong>
          <Delta cur={totals.fixed} prev={prev.fixed} label={vsLabel} />
        </button>
        <button type="button" className={`card fin-kpi${kindFilter === 'variable' ? ' active' : ''}`}
          onClick={() => { setTab('list'); setKindFilter((k) => (k === 'variable' ? 'all' : 'variable')); }}>
          <span className="fin-kpi-label"><i className="fin-dot variable" />Variables</span>
          <strong className="fin-kpi-value">{usd(totals.variable)}</strong>
          <Delta cur={totals.variable} prev={prev.variable} label={vsLabel} />
        </button>
        <div className="card fin-kpi">
          <span className="fin-kpi-label">Ventas − gastos</span>
          <strong className={`fin-kpi-value${result !== null && result < 0 ? ' late' : ' good'}`}>{result === null ? '—' : usd(result)}</strong>
          {result === null ? <span className="fin-delta none">Sin datos de ventas</span>
            : <span className="fin-kpi-sub">Vendiste {usd(sales)}{prev.sales > 0 && prevResult !== 0 ? ` · antes ${usd(prevResult)}` : ''}</span>}
        </div>
      </div>

      <div className="fin-tabs-row">
        <div className="fin-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'list'} className={`fin-tab${tab === 'list' ? ' active' : ''}`}
            onClick={() => setTab('list')}>Gastos del período{totals.count > 0 && <span className="fin-tab-count">{totals.count}</span>}</button>
          <button type="button" role="tab" aria-selected={tab === 'fixed'} className={`fin-tab${tab === 'fixed' ? ' active' : ''}`}
            onClick={() => setTab('fixed')}>Gastos fijos{dueSoon.length > 0
              ? <span className="fin-tab-count alert">{dueSoon.length}</span>
              : activeFixed.length > 0 && <span className="fin-tab-count">{activeFixed.length}</span>}</button>
        </div>
      </div>

      <div className="fin-layout">
        <div className="fin-main">
          {tab === 'list' ? (
            <div className="card fin-board">
              <div className="fin-toolbar">
                <div className="fin-search-wrap">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                  <input type="search" className="fin-search" value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar gasto o proveedor" />
                </div>
                <select className="fin-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría">
                  <option value="">Todas las categorías</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="none">Sin categoría</option>
                </select>
                <div className="chip-row">
                  {KINDS.map(([k, l]) => (
                    <button key={k} type="button" className={`chip${kindFilter === k ? ' on' : ''}`} onClick={() => setKindFilter(k)}>
                      {l}{k === 'pending' && totals.pendingN > 0 ? ` (${totals.pendingN})` : ''}
                    </button>
                  ))}
                </div>
              </div>

              {rows === null ? <div className="fin-empty"><span className="muted">Cargando…</span></div> : filtered.length === 0 ? (
                <div className="fin-empty">
                  <div className="fin-empty-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="26" height="26"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M9 8h6M9 11.5h6M9 15h3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </div>
                  <p className="fin-empty-title">{filtering ? 'Nada coincide con el filtro' : `Sin gastos en ${periodLabel(period).toLowerCase()}`}</p>
                  <p className="muted">{filtering ? 'Prueba con otra categoría o búsqueda.' : 'Anota cada gasto: así sabes cuánto ganas de verdad, no solo cuánto vendes.'}</p>
                  {filtering
                    ? <button type="button" className="btn" onClick={() => { setCategory(''); setKindFilter('all'); setSearch(''); }}>Quitar filtros</button>
                    : <button type="button" className="btn" onClick={() => setForm({})}>+ Agregar gasto</button>}
                </div>
              ) : (
                <div className="fin-table" role="table">
                  <div className="fin-grid-row fin-exp-row fin-thead" role="row">
                    <SortHead label="Fecha" k="date" sort={sort} setSort={setSort} />
                    <SortHead label="Gasto" k="name" sort={sort} setSort={setSort} />
                    <SortHead label="Categoría" k="category" sort={sort} setSort={setSort} />
                    <span className="fin-th">Pagado con</span>
                    <SortHead label="Monto" k="amount" sort={sort} setSort={setSort} align="right" />
                    <span />
                  </div>
                  {filtered.map((e) => (
                    <div className="fin-grid-row fin-exp-row fin-click" role="row" key={e.id} tabIndex={0}
                      onClick={() => setEditing(e)}
                      onKeyDown={(ev) => { if (ev.key === 'Enter') setEditing(e); }}>
                      <span className="fin-date">
                        <strong>{e.spent_on.slice(8, 10)}</strong>
                        <span>{MONTHS[Number(e.spent_on.slice(5, 7)) - 1].slice(0, 3)}</span>
                      </span>
                      <span className="fin-exp-main">
                        <strong>
                          {e.name}
                          {e.receipt_path && (
                            <button type="button" className="fin-clip" title="Ver comprobante" aria-label="Ver comprobante"
                              onClick={(ev) => { ev.stopPropagation(); openReceipt(e.receipt_path); }}>{ClipIcon}</button>
                          )}
                        </strong>
                        <span>
                          {e.kind === 'fixed' ? 'Fijo' : 'Variable'}
                          {e.supplier_name && ` · ${e.supplier_name}`}
                          {e.note && ` · ${e.note}`}
                        </span>
                      </span>
                      <span className="fin-exp-cat" data-label="Categoría">
                        {e.category_id ? <span className="fin-tag">{catName.get(e.category_id)}</span> : <span className="fin-faint">—</span>}
                      </span>
                      <span className="fin-exp-paid" data-label="Pagado con">
                        {e.status === 'pending'
                          ? <Link to="/accounts" className="due-pill soon" onClick={(ev) => ev.stopPropagation()}>Por pagar</Link>
                          : e.account_name || '—'}
                      </span>
                      <span className="fin-cell-num fin-strong">
                        {usd(e.amount_usd)}
                        {e.currency === 'VES' && <small>{bs(e.amount)}</small>}
                      </span>
                      <span className="fin-cell-actions" onClick={(ev) => ev.stopPropagation()}>
                        <RowMenu items={[
                          { label: 'Editar', onClick: () => setEditing(e) },
                          { label: 'Ver comprobante', onClick: () => openReceipt(e.receipt_path), hidden: !e.receipt_path },
                          { label: 'Borrar', onClick: () => onDelete(e), danger: true },
                        ]} />
                      </span>
                    </div>
                  ))}
                  <div className="fin-grid-row fin-exp-row fin-tfoot" role="row">
                    <span />
                    <span>{filtered.length} {filtered.length === 1 ? 'gasto' : 'gastos'}{filtering ? ' filtrados' : ''}</span>
                    <span /><span />
                    <span className="fin-cell-num">{usd(filteredTotal)}</span>
                    <span />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card fin-board">
              <div className="fin-toolbar">
                <p className="fin-toolbar-note">
                  {activeFixed.length
                    ? <>Unos <strong>{usd(monthlyFixed)}</strong> al mes en gastos fijos. Te avisamos 5 días antes de cada pago.</>
                    : 'Alquiler, nómina, internet… Te avisamos antes de que venzan y los registras con un toque.'}
                </p>
                <button type="button" className="btn sm" onClick={() => setForm({ fixed: true })}>+ Gasto fijo</button>
              </div>
              {recurring.length === 0 ? (
                <div className="fin-empty">
                  <div className="fin-empty-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="26" height="26"><rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </div>
                  <p className="fin-empty-title">Todavía no tienes gastos fijos</p>
                  <p className="muted">Agrega los que se repiten cada mes y no se te pasa ninguno.</p>
                  <button type="button" className="btn" onClick={() => setForm({ fixed: true })}>+ Gasto fijo</button>
                </div>
              ) : (
                <div className="fin-table" role="table">
                  <div className="fin-grid-row fin-fix-row fin-thead" role="row">
                    <span className="fin-th">Gasto</span>
                    <span className="fin-th">Frecuencia</span>
                    <span className="fin-th">Próximo pago</span>
                    <span className="fin-th fin-th-right">Monto</span>
                    <span />
                  </div>
                  {[...recurring].sort((a, b) => Number(b.active) - Number(a.active) || a.next_due.localeCompare(b.next_due)).map((r) => {
                    const di = dueInfo(r.next_due, 5);
                    return (
                      <div className={`fin-grid-row fin-fix-row${r.active ? '' : ' paused'}`} role="row" key={r.id}>
                        <span className="fin-exp-main">
                          <strong>{r.name}</strong>
                          <span>{r.category_id ? catName.get(r.category_id) : 'Sin categoría'}{!r.active && ' · en pausa'}</span>
                        </span>
                        <span className="fin-muted-cell" data-label="Frecuencia">{FREQ_LABEL[r.frequency]}</span>
                        <span className="fin-cell-due" data-label="Próximo pago">
                          {r.active
                            ? <span className="fin-next"><span>{formatDate(r.next_due)}</span><span className={`due-text ${di.tone}`}>{di.tone === 'ok' ? `en ${di.days} días` : di.label}</span></span>
                            : <span className="fin-faint">—</span>}
                        </span>
                        <span className="fin-cell-num fin-strong">
                          {r.currency === 'USD' ? usd(r.amount) : bs(r.amount)}
                          {r.currency === 'VES' && rate.value > 0 && <small>≈ {usd(r.amount / rate.value)}</small>}
                        </span>
                        <span className="fin-cell-actions">
                          {r.active && (
                            <button type="button" className={`btn sm${di.tone !== 'ok' ? ' primary' : ''}`} onClick={() => setForm({ template: r })}>
                              Pagar
                            </button>
                          )}
                          <RowMenu items={[
                            { label: 'Editar', onClick: () => setEditingFixed(r) },
                            { label: r.active ? 'Pausar avisos' : 'Reactivar', onClick: () => toggleFixed(r) },
                            { label: 'Quitar', onClick: () => onDeleteFixed(r), danger: true },
                          ]} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="fin-side">
          <div className="card fin-side-card">
            <div className="fin-side-head">
              <h2>Por categoría</h2>
              {category && <button type="button" className="fm-link" onClick={() => setCategory('')}>Ver todas</button>}
            </div>
            {byCategory.length === 0 ? <p className="muted fin-side-empty">Cuando registres gastos verás aquí en qué se va la plata.</p> : (
              <ul className="fin-bars">
                {byCategory.map((c) => {
                  const share = totals.all ? Math.round((c.total / totals.all) * 100) : 0;
                  return (
                    <li key={c.id}>
                      <button type="button" className={`fin-bar-row${category === c.id ? ' on' : ''}`}
                        title={`${c.name}: ${usd(c.total)} (${share}% del total)`}
                        onClick={() => { setCategory((x) => (x === c.id ? '' : c.id)); setTab('list'); }}>
                        <span className="fin-bar-label"><span>{c.name}</span><strong>{usd(c.total)}</strong></span>
                        <span className="fin-bar-line">
                          <span className="fin-bar-track"><span className="fin-bar" style={{ width: `${maxCat ? Math.max(3, (c.total / maxCat) * 100) : 0}%` }} /></span>
                          <span className="fin-bar-pct">{share}%</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="card fin-side-card">
            <h2>Ventas frente a gastos</h2>
            {sales === null ? <p className="muted fin-side-empty">No se pudieron cargar las ventas.</p> : (
              <>
                <div className="fin-vs-row"><span>Ventas</span><strong>{usd(sales)}</strong></div>
                <div className="fin-vs-row"><span>Gastos</span><strong>− {usd(totals.all)}</strong></div>
                <div className={`fin-vs-row total${result < 0 ? ' late' : ''}`}>
                  <span>{result < 0 ? 'Pérdida' : 'Te queda'}</span><strong>{usd(Math.abs(result))}</strong>
                </div>
                {sales > 0 && (
                  <div className="fin-vs-meter" title={`Los gastos son el ${Math.round((totals.all / sales) * 100)}% de las ventas`}>
                    <span style={{ width: `${Math.min(100, (totals.all / sales) * 100)}%` }} />
                  </div>
                )}
                <p className="fin-vs-note">
                  {sales > 0 ? `Los gastos son el ${Math.round((totals.all / sales) * 100)}% de lo vendido. ` : ''}
                  Ventas sin cancelar y con descuentos; no resta el costo de la mercancía.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>

      {form && (
        <ExpenseForm form={form} business={business} branchId={branchId} rate={rate}
          categories={categories} accounts={accounts} suppliers={suppliers} onNewCategory={onNewCategory}
          onClose={() => setForm(null)}
          onSaved={async (msg) => {
            setForm(null); await Promise.all([load(), loadRecurring()]); notifyCashChanged(); setToast(msg);
          }} />
      )}
      {editing && (
        <ExpenseEdit expense={editing} business={business} categories={categories} onNewCategory={onNewCategory}
          catName={catName} onOpenReceipt={openReceipt}
          onDelete={() => { const e = editing; setEditing(null); onDelete(e); }}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); setToast({ text: 'Cambios guardados' }); }} />
      )}
      {editingFixed && (
        <FixedEdit item={editingFixed} categories={categories} onNewCategory={onNewCategory}
          onClose={() => setEditingFixed(null)}
          onSaved={async () => { setEditingFixed(null); await loadRecurring(); setToast({ text: 'Gasto fijo actualizado' }); }} />
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

// Categoría con opción de crear una nueva sin salir del formulario.
function CategorySelect({ value, onChange, categories, onNewCategory }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try { const c = await onNewCategory(name); onChange(c.id); setAdding(false); setName(''); }
    catch (e) { setErr(/duplicate|unique/i.test(e.message) ? 'Ya existe esa categoría' : e.message); }
    finally { setBusy(false); }
  }

  if (adding) {
    return (
      <>
        <div className="fm-inline">
          <input autoFocus value={name} placeholder="Nombre de la categoría" aria-label="Nueva categoría"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); create(); }
              if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); }
            }} />
          <button type="button" className="btn sm primary" disabled={busy || !name.trim()} onClick={create}>Crear</button>
          <button type="button" className="btn sm ghost" onClick={() => setAdding(false)}>Cancelar</button>
        </div>
        {err && <span className="fm-help bad">{err}</span>}
      </>
    );
  }
  return (
    <select value={value} onChange={(e) => (e.target.value === '__new__' ? setAdding(true) : onChange(e.target.value))}>
      <option value="">Sin categoría</option>
      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      <option value="__new__">+ Nueva categoría…</option>
    </select>
  );
}

// Monto en $ y en Bs a la vez: se escribe en cualquiera y el otro se calcula
// con la tasa. El gasto se guarda en la moneda del campo que se escribió.
function AmountPair({ f, setF, rate }) {
  const r = num(f.rate);
  const setUsd = (v) => setF((x) => ({ ...x, lead: 'USD', usd: v, ves: num(v) && r ? round2(num(v) * r).toFixed(2) : '' }));
  const setVes = (v) => setF((x) => ({ ...x, lead: 'VES', ves: v, usd: num(v) && r ? round2(num(v) / r).toFixed(2) : '' }));
  const setRate = (v) => setF((x) => {
    const nr = num(v);
    if (x.lead === 'USD') return { ...x, rate: v, ves: num(x.usd) && nr ? round2(num(x.usd) * nr).toFixed(2) : '' };
    return { ...x, rate: v, usd: num(x.ves) && nr ? round2(num(x.ves) / nr).toFixed(2) : '' };
  });
  return (
    <div className="fm-grid fm-grid-3">
      <div className="fm-field">
        <span className="fm-label">Monto en dólares</span>
        <div className={`fm-input-affix${f.lead === 'USD' ? ' lead' : ''}`}>
          <input inputMode="decimal" placeholder="0,00" value={f.usd} onChange={(e) => setUsd(e.target.value)} aria-label="Monto en dólares" />
          <span>$</span>
        </div>
      </div>
      <div className="fm-field">
        <span className="fm-label">Monto en bolívares</span>
        <div className={`fm-input-affix${f.lead === 'VES' ? ' lead' : ''}`}>
          <input inputMode="decimal" placeholder="0,00" value={f.ves} onChange={(e) => setVes(e.target.value)} aria-label="Monto en bolívares" />
          <span>Bs</span>
        </div>
      </div>
      <div className="fm-field">
        <span className="fm-label">Tasa</span>
        <div className="fm-input-affix">
          <input inputMode="decimal" value={f.rate} onChange={(e) => setRate(e.target.value)} aria-label="Tasa de cambio" />
          <span>Bs/$</span>
        </div>
        {rate.value > 0 && (num(f.rate) === rate.value
          ? <span className="fm-help">{rate.label}</span>
          : <button type="button" className="fm-link fm-help" onClick={() => setRate(String(rate.value))}>Usar {rate.label}</button>)}
      </div>
    </div>
  );
}

// ---------- Agregar gasto (variable, fijo o pago de un fijo) ----------
function ExpenseForm({ form, business, branchId, rate, categories, accounts, suppliers, onNewCategory, onClose, onSaved }) {
  const t = form.template;
  const today = localISO();
  const [f, setF] = useState(() => {
    const r = rate.value ? String(rate.value) : '';
    const base = { lead: t?.currency || 'USD', usd: '', ves: '', rate: r };
    if (t) {
      const a = Number(t.amount);
      if (t.currency === 'USD') { base.usd = a.toFixed(2); base.ves = rate.value ? round2(a * rate.value).toFixed(2) : ''; }
      else { base.ves = a.toFixed(2); base.usd = rate.value ? round2(a / rate.value).toFixed(2) : ''; }
    }
    return {
      ...base,
      kind: t || form.fixed ? 'fixed' : 'variable',
      name: t?.name || '', categoryId: t?.category_id || '', supplierId: t?.supplier_id || '',
      spentOn: today,
      accountId: accounts.find((a) => a.is_cash)?.id || accounts[0]?.id || PENDING,
      dueDate: addDays(today, 7),
      frequency: 'monthly', payNow: true, nextDue: nextDue(today, 'monthly'),
      note: '',
    };
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {   // la tasa puede llegar con el formulario abierto
    if (rate.value) setF((x) => (x.rate ? x : { ...x, rate: String(rate.value) }));
  }, [rate.value]);

  const amount = f.lead === 'USD' ? num(f.usd) : num(f.ves);
  const r = num(f.rate);
  const amtUsd = f.lead === 'USD' ? amount : (r ? round2(amount / r) : 0);
  const newFixed = f.kind === 'fixed' && !t;
  const registering = !newFixed || f.payNow;
  const account = accounts.find((a) => a.id === f.accountId);
  const valid = amount > 0 && f.name.trim() && (f.lead === 'USD' || r > 0);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      let recurringId = t?.id || null;
      if (newFixed) {
        const tpl = await createRecurringExpense(business.id, {
          name: f.name.trim(), category_id: f.categoryId || null, supplier_id: f.supplierId || null,
          amount, currency: f.lead, frequency: f.frequency,
          // Registrando el pago ya, create_expense avanza la fecha desde hoy.
          next_due: f.payNow ? f.spentOn : f.nextDue, branch_id: branchId || null,
        });
        recurringId = f.payNow ? tpl.id : null;
      }
      if (registering) {
        const receipt = file ? await uploadExpenseReceipt(business.id, file) : '';
        await createExpense({
          kind: f.kind, name: f.name.trim(), category_id: f.categoryId || null, supplier_id: f.supplierId || null,
          amount, currency: f.lead, rate: r, spent_on: f.spentOn,
          account_id: f.accountId === PENDING ? null : f.accountId,
          due_date: f.accountId === PENDING ? f.dueDate : null,
          note: f.note, receipt_path: receipt, branch_id: branchId || null, recurring_id: recurringId,
        });
      }
      await onSaved(newFixed && !f.payNow
        ? { text: 'Gasto fijo guardado', sub: `te avisamos el ${formatDate(f.nextDue)}` }
        : { text: f.accountId === PENDING ? 'Gasto por pagar registrado' : 'Gasto registrado', sub: `${f.name.trim()} · ${usd(amtUsd)}` });
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <FinModal title={t ? `Pagar ${t.name}` : 'Agregar gasto'}
      sub={t ? `${FREQ_LABEL[t.frequency]} · tocaba el ${formatDate(t.next_due)}` : null}
      onClose={onClose} busy={busy} onSubmit={onSubmit} wide
      footer={(
        <>
          <span className="fm-foot-note">
            {amount > 0 && `Total: ${usd(amtUsd)}${r ? ` · ${bs(amtUsd * r)}` : ''}`}
          </span>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || !valid}>
            {busy ? 'Guardando…' : newFixed && !f.payNow ? 'Guardar gasto fijo' : 'Confirmar gasto'}
          </button>
        </>
      )}>
      {!t && (
        <div className="fin-choice">
          {[['variable', 'Gasto variable', 'Una vez: almuerzo, reparación, bolsas'], ['fixed', 'Gasto fijo', 'Se repite: alquiler, nómina, internet']].map(([k, l, h]) => (
            <label key={k} className={`fin-choice-opt${f.kind === k ? ' on' : ''}`}>
              <input type="radio" name="kind" checked={f.kind === k} onChange={() => setF((x) => ({ ...x, kind: k }))} />
              <span className="fin-radio" aria-hidden="true" />
              <span className="fin-choice-text"><strong>{l}</strong><span>{h}</span></span>
            </label>
          ))}
        </div>
      )}

      <div className="fm-grid">
        <label>Nombre del gasto
          <input required value={f.name} onChange={set('name')} autoFocus={!t}
            placeholder={f.kind === 'fixed' ? 'Alquiler del local' : 'Bolsas y empaques'} />
        </label>
        <label>Categoría
          <CategorySelect value={f.categoryId} onChange={(v) => setF((x) => ({ ...x, categoryId: v }))}
            categories={categories} onNewCategory={onNewCategory} />
        </label>
      </div>

      <AmountPair f={f} setF={setF} rate={rate} />

      {newFixed && (
        <div className="fm-box">
          <div className="fm-grid">
            <label>Frecuencia
              <select value={f.frequency} onChange={(e) => setF((x) => ({ ...x, frequency: e.target.value, nextDue: nextDue(x.spentOn, e.target.value) }))}>
                {FREQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label>{f.payNow ? 'Siguiente pago' : 'Próximo pago'}
              {f.payNow
                ? <input value={formatDate(nextDue(f.spentOn, f.frequency))} disabled />
                : <input type="date" value={f.nextDue} onChange={set('nextDue')} required />}
            </label>
          </div>
          <label className="fin-check">
            <input type="checkbox" checked={f.payNow} onChange={(e) => setF((x) => ({ ...x, payNow: e.target.checked }))} />
            Ya pagué el de este período: registrarlo ahora
          </label>
        </div>
      )}

      {registering && (
        <>
          <div className="fm-grid">
            <label>Fecha del pago
              <input type="date" value={f.spentOn} max={today} onChange={set('spentOn')} />
            </label>
            <label>Pagado con
              <select value={f.accountId} onChange={set('accountId')}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency === 'USD' ? '$' : 'Bs'}</option>)}
                <option value={PENDING}>Aún no lo pago (queda por pagar)</option>
              </select>
            </label>
          </div>
          {f.accountId === PENDING ? (
            <div className="fm-box">
              <label>¿Para cuándo hay que pagarlo?
                <input type="date" value={f.dueDate} min={f.spentOn} onChange={set('dueDate')} required />
              </label>
              <p className="fm-note">Queda en Cuentas por pagar y se marca pagado cuando lo pagues ahí.</p>
            </div>
          ) : account?.is_cash && (
            <p className="fm-note">Es efectivo: sale de la caja si está abierta.</p>
          )}

          <details className="fm-more" open={!!(f.supplierId || f.note)}>
            <summary>Proveedor, comprobante y nota</summary>
            <div className="fm-more-body">
              <div className="fm-grid">
                <label><span className="fm-label">Proveedor <span className="fm-optional">(opcional)</span></span>
                  <select value={f.supplierId} onChange={set('supplierId')}>
                    <option value="">Ninguno</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <div className="fm-field">
                  <span className="fm-label">Comprobante <span className="fm-optional">(opcional)</span></span>
                  <label className="fm-file">
                    <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                    <span className="fm-file-btn">{file ? 'Cambiar' : 'Adjuntar'}</span>
                    <span className="fm-file-name">{file ? file.name : 'Foto o PDF de la factura'}</span>
                  </label>
                </div>
              </div>
              <label><span className="fm-label">Nota <span className="fm-optional">(opcional)</span></span>
                <textarea rows={2} value={f.note} onChange={set('note')} placeholder="Factura 0045, pagado a Juan…" />
              </label>
            </div>
          </details>
        </>
      )}
      {error && <div className="form-error">{error}</div>}
    </FinModal>
  );
}

// ---------- Ver / editar un gasto (el monto y la cuenta no se tocan) ----------
function ExpenseEdit({ expense, business, categories, onNewCategory, onOpenReceipt, onDelete, onClose, onSaved }) {
  const [f, setF] = useState({
    name: expense.name, categoryId: expense.category_id || '', spentOn: expense.spent_on, note: expense.note,
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const patch = { name: f.name.trim(), category_id: f.categoryId || null, spent_on: f.spentOn, note: f.note.trim() };
      if (file) patch.receipt_path = await uploadExpenseReceipt(business.id, file);
      await updateExpense(expense.id, patch);
      await onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <FinModal title={expense.name} sub={`${expense.kind === 'fixed' ? 'Gasto fijo' : 'Gasto variable'} · ${formatDate(expense.spent_on)}`}
      onClose={onClose} busy={busy} onSubmit={onSubmit}
      footer={(
        <>
          <button type="button" className="btn danger fm-foot-left" disabled={busy} onClick={onDelete}>Borrar gasto</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || !f.name.trim()}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <div className="fin-pay-summary">
        <span>{expense.status === 'pending' ? 'Por pagar' : `Pagado con ${expense.account_name || '—'}`}</span>
        <strong>{usd(expense.amount_usd)}</strong>
        <span>{expense.currency === 'VES' ? `${bs(expense.amount)} · tasa ${bs(expense.rate)}` : 'Para cambiar el monto o la cuenta, bórralo y regístralo de nuevo.'}</span>
      </div>
      <label>Nombre <input required value={f.name} onChange={set('name')} /></label>
      <div className="fm-grid">
        <label>Categoría
          <CategorySelect value={f.categoryId} onChange={(v) => setF((x) => ({ ...x, categoryId: v }))}
            categories={categories} onNewCategory={onNewCategory} />
        </label>
        <label>Fecha <input type="date" value={f.spentOn} onChange={set('spentOn')} /></label>
      </div>
      <div className="fm-field">
        <span className="fm-label">Comprobante</span>
        <div className="fm-inline">
          {expense.receipt_path && !file && (
            <button type="button" className="btn sm" onClick={() => onOpenReceipt(expense.receipt_path)}>Ver comprobante</button>
          )}
          <label className="fm-file">
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <span className="fm-file-btn">{expense.receipt_path || file ? 'Reemplazar' : 'Adjuntar'}</span>
            <span className="fm-file-name">{file ? file.name : expense.receipt_path ? '' : 'Foto o PDF de la factura'}</span>
          </label>
        </div>
      </div>
      <label><span className="fm-label">Nota <span className="fm-optional">(opcional)</span></span>
        <textarea rows={2} value={f.note} onChange={set('note')} />
      </label>
      {error && <div className="form-error">{error}</div>}
    </FinModal>
  );
}

// ---------- Editar un gasto fijo ----------
function FixedEdit({ item, categories, onNewCategory, onClose, onSaved }) {
  const [f, setF] = useState({
    name: item.name, categoryId: item.category_id || '', amount: String(item.amount), currency: item.currency,
    frequency: item.frequency, nextDue: item.next_due, active: item.active,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await updateRecurringExpense(item.id, {
        name: f.name.trim(), category_id: f.categoryId || null, amount: num(f.amount), currency: f.currency,
        frequency: f.frequency, next_due: f.nextDue, active: f.active,
      });
      await onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <FinModal title="Editar gasto fijo" sub={item.name} onClose={onClose} busy={busy} onSubmit={onSubmit}
      footer={(
        <>
          <span className="fm-foot-note" />
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || num(f.amount) <= 0 || !f.name.trim()}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <div className="fm-grid">
        <label>Nombre <input required value={f.name} onChange={set('name')} /></label>
        <label>Categoría
          <CategorySelect value={f.categoryId} onChange={(v) => setF((x) => ({ ...x, categoryId: v }))}
            categories={categories} onNewCategory={onNewCategory} />
        </label>
      </div>
      <div className="fm-grid">
        <div className="fm-field">
          <span className="fm-label">Monto</span>
          <div className="fm-money">
            <div className="seg sm">
              {['USD', 'VES'].map((c) => (
                <button key={c} type="button" className={`seg-btn${f.currency === c ? ' active' : ''}`}
                  onClick={() => setF((x) => ({ ...x, currency: c }))}>{c === 'USD' ? '$' : 'Bs'}</button>
              ))}
            </div>
            <input required inputMode="decimal" value={f.amount} onChange={set('amount')} aria-label="Monto" />
          </div>
        </div>
        <label>Frecuencia
          <select value={f.frequency} onChange={set('frequency')}>
            {FREQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
      <div className="fm-grid">
        <label>Próximo pago <input type="date" value={f.nextDue} onChange={set('nextDue')} required /></label>
        <div className="fm-field fm-field-end">
          <label className="fin-check">
            <input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} />
            Avisarme cuando venza
          </label>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
    </FinModal>
  );
}
