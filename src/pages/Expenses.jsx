import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { useConfirm } from '../components/Confirm';
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
const FREQ = [
  ['weekly', 'Semanal'], ['biweekly', 'Quincenal'], ['monthly', 'Mensual'],
  ['quarterly', 'Trimestral'], ['yearly', 'Anual'],
];
const FREQ_LABEL = Object.fromEntries(FREQ);
const PENDING = '__pending__';

function nextDue(iso, freq) {
  const [y, m, d] = iso.split('-').map(Number);
  if (freq === 'weekly') return addDays(iso, 7);
  if (freq === 'biweekly') return addDays(iso, 14);
  const add = freq === 'quarterly' ? 3 : freq === 'yearly' ? 12 : 1;
  // Fin de mes: el 31 pasa al último día del mes siguiente, no al día 1 del otro.
  const last = new Date(y, m - 1 + add + 1, 0).getDate();
  return localISO(new Date(y, m - 1 + add, Math.min(d, last)));
}

// Rango del período: [desde, hasta) en fechas locales.
function periodRange(p) {
  if (p.mode === 'year') return [localISO(new Date(p.y, 0, 1)), localISO(new Date(p.y + 1, 0, 1))];
  return [localISO(new Date(p.y, p.m, 1)), localISO(new Date(p.y, p.m + 1, 1))];
}
function shiftPeriod(p, dir) {
  if (p.mode === 'year') return { ...p, y: p.y + dir };
  const d = new Date(p.y, p.m + dir, 1);
  return { ...p, y: d.getFullYear(), m: d.getMonth() };
}
const periodLabel = (p) => (p.mode === 'year' ? String(p.y) : `${MONTHS[p.m]} ${p.y}`);
const toTs = (iso) => new Date(`${iso}T00:00:00`).toISOString();

const ClipIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M8.5 12.5l5.8-5.8a2.6 2.6 0 0 1 3.7 3.7l-7.3 7.3a4.2 4.2 0 0 1-6-6l6.6-6.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
);

export default function Expenses() {
  const { business } = useAuth();
  const { branchId } = useBranch();
  const ask = useConfirm();
  const now = new Date();

  const [period, setPeriod] = useState({ mode: 'month', y: now.getFullYear(), m: now.getMonth() });
  const [tab, setTab] = useState('list');               // 'list' | 'fixed'
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');

  const [rows, setRows] = useState(null);               // gastos del período
  const [prevTotal, setPrevTotal] = useState(0);
  const [sales, setSales] = useState(null);
  const [categories, setCategories] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [rate, setRate] = useState({ value: 0 });
  const [error, setError] = useState(null);

  const [form, setForm] = useState(null);               // { mode: 'new' | 'template', template? }
  const [editing, setEditing] = useState(null);         // gasto en edición
  const [editingFixed, setEditingFixed] = useState(null);

  const [from, to] = periodRange(period);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [pFrom] = periodRange(shiftPeriod(period, -1));
      const all = await fetchExpenses(pFrom, addDays(to, -1));
      setRows(all.filter((e) => e.spent_on >= from));
      setPrevTotal(round2(all.filter((e) => e.spent_on < from).reduce((s, e) => s + Number(e.amount_usd), 0)));
      fetchSalesTotal(toTs(from), toTs(to)).then(setSales).catch(() => setSales(null));
    } catch (e) { setError(e.message); setRows([]); }
  }, [period, from, to]);

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
  const filtered = useMemo(() => {
    const q = norm(search.trim());
    return (rows || []).filter((e) => {
      if (category && (e.category_id || '') !== (category === 'none' ? '' : category)) return false;
      if (q && !norm([e.name, e.supplier_name, e.note, catName.get(e.category_id), e.account_name].join(' ')).includes(q)) return false;
      return true;
    });
  }, [rows, category, search, catName]);

  const totals = useMemo(() => {
    const list = rows || [];
    const sum = (l) => round2(l.reduce((s, e) => s + Number(e.amount_usd), 0));
    return {
      all: sum(list),
      fixed: sum(list.filter((e) => e.kind === 'fixed')),
      variable: sum(list.filter((e) => e.kind === 'variable')),
      pending: sum(list.filter((e) => e.status === 'pending')),
      count: list.length,
    };
  }, [rows]);
  const change = prevTotal > 0 ? ((totals.all - prevTotal) / prevTotal) * 100 : null;
  const result = sales === null ? null : round2(sales - totals.all);

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

  const dueSoon = recurring.filter((r) => r.active && dueInfo(r.next_due, 5).tone !== 'ok');

  // ---------- acciones ----------
  async function onDelete(e) {
    if (!await ask({
      title: '¿Borrar este gasto?',
      message: `${e.name} · ${usd(e.amount_usd)} del ${formatDate(e.spent_on)}.${e.cash_movement_id ? ' Si la caja sigue abierta, la plata vuelve a la caja.' : ''}`,
      confirmLabel: 'Borrar gasto',
    })) return;
    try { await deleteExpense(e.id); await load(); notifyCashChanged(); }
    catch (err) { setError(err.message); }
  }

  async function onDeleteFixed(r) {
    if (!await ask({
      title: `¿Quitar “${r.name}” de los gastos fijos?`,
      message: 'Los pagos ya registrados se mantienen; solo deja de avisarte.',
      confirmLabel: 'Quitar',
    })) return;
    try { await deleteRecurringExpense(r.id); await loadRecurring(); }
    catch (err) { setError(err.message); }
  }

  async function openReceipt(path) {
    try { window.open(await expenseReceiptUrl(path), '_blank', 'noopener'); }
    catch (err) { setError(err.message); }
  }

  async function onNewCategory(name) {
    const c = await createExpenseCategory(business.id, name);
    setCategories((prev) => [...prev, c]);
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

  return (
    <div className="page fin-page">
      <header className="page-head">
        <div>
          <h1>Gastos</h1>
          <p className="page-sub">En qué se va la plata y cuánto queda después de vender.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn ghost" onClick={exportCsv} disabled={!filtered.length}>Exportar</button>
          <button type="button" className="btn primary" onClick={() => setForm({ mode: 'new' })}>+ Agregar gasto</button>
        </div>
      </header>

      {error && <div className="form-error" onClick={() => setError(null)}>{error}</div>}

      {dueSoon.length > 0 && (
        <div className="fin-alert">
          <strong>{dueSoon.length === 1 ? 'Un gasto fijo vence pronto' : `${dueSoon.length} gastos fijos vencen pronto`}:</strong>{' '}
          {dueSoon.slice(0, 3).map((r, i) => (
            <span key={r.id}>{i > 0 && ', '}{r.name} <span className="muted">({dueInfo(r.next_due, 5).label.toLowerCase()})</span></span>
          ))}
          {dueSoon.length > 3 && '…'}{' '}
          <button type="button" className="link-btn" onClick={() => setTab('fixed')}>Ver gastos fijos</button>
        </div>
      )}

      <div className="fin-period">
        <div className="fin-period-nav">
          <button type="button" className="icon-btn" aria-label="Período anterior" onClick={() => setPeriod((p) => shiftPeriod(p, -1))}>‹</button>
          <strong>{periodLabel(period)}</strong>
          <button type="button" className="icon-btn" aria-label="Período siguiente" disabled={isCurrent}
            onClick={() => setPeriod((p) => shiftPeriod(p, 1))}>›</button>
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
            {period.mode === 'year' ? 'Este año' : 'Este mes'}
          </button>
        )}
      </div>

      <div className="fin-kpis">
        <div className="card fin-kpi">
          <span className="fin-kpi-label">Gastos {period.mode === 'year' ? 'del año' : 'del mes'}</span>
          <strong className="fin-kpi-value">{usd(totals.all)}</strong>
          <span className="fin-kpi-sub">
            {change === null ? `${totals.count} ${totals.count === 1 ? 'gasto' : 'gastos'}` : (
              <span className={`fin-trend ${change > 0 ? 'up' : 'down'}`}>
                {change > 0 ? '▲' : '▼'} {Math.abs(change).toFixed(0)}% vs. {period.mode === 'year' ? 'el año pasado' : 'el mes pasado'}
              </span>
            )}
          </span>
        </div>
        <div className="card fin-kpi">
          <span className="fin-kpi-label">Fijos</span>
          <strong className="fin-kpi-value">{usd(totals.fixed)}</strong>
          <span className="fin-kpi-sub">{totals.all ? `${Math.round((totals.fixed / totals.all) * 100)}% del total` : 'Alquiler, nómina, servicios'}</span>
        </div>
        <div className="card fin-kpi">
          <span className="fin-kpi-label">Variables</span>
          <strong className="fin-kpi-value">{usd(totals.variable)}</strong>
          <span className="fin-kpi-sub">{totals.pending > 0 ? `${usd(totals.pending)} por pagar` : totals.all ? `${Math.round((totals.variable / totals.all) * 100)}% del total` : 'Lo del día a día'}</span>
        </div>
        <div className="card fin-kpi">
          <span className="fin-kpi-label">Ventas − gastos</span>
          <strong className={`fin-kpi-value${result !== null && result < 0 ? ' late' : ''}`}>{result === null ? '—' : usd(result)}</strong>
          <span className="fin-kpi-sub">
            {sales === null ? 'Sin datos de ventas' : `Vendiste ${usd(sales)}${sales > 0 ? ` · gastos ${Math.round((totals.all / sales) * 100)}%` : ''}`}
          </span>
        </div>
      </div>

      <div className="fin-layout">
        <div>
          <div className="fin-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'list'} className={`fin-tab${tab === 'list' ? ' active' : ''}`}
              onClick={() => setTab('list')}>Movimientos{totals.count > 0 && <span className="fin-tab-count">{totals.count}</span>}</button>
            <button type="button" role="tab" aria-selected={tab === 'fixed'} className={`fin-tab${tab === 'fixed' ? ' active' : ''}`}
              onClick={() => setTab('fixed')}>Gastos fijos{dueSoon.length > 0 && <span className="fin-tab-count alert">{dueSoon.length}</span>}</button>
          </div>

          {tab === 'list' ? (
            <div className="card fin-board">
              <div className="fin-toolbar">
                <input type="search" className="fin-search" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar gasto, proveedor o nota…" />
                <select className="fin-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría">
                  <option value="">Todas las categorías</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="none">Sin categoría</option>
                </select>
              </div>
              {rows === null ? <div className="empty">Cargando…</div> : filtered.length === 0 ? (
                <div className="fin-empty">
                  <p><strong>{rows.length ? 'Nada coincide con el filtro.' : `Sin gastos en ${periodLabel(period).toLowerCase()}.`}</strong></p>
                  <p className="muted">Anota cada gasto: así sabes cuánto ganas de verdad, no solo cuánto vendes.</p>
                  {!rows.length && <button type="button" className="btn" onClick={() => setForm({ mode: 'new' })}>Agregar gasto</button>}
                </div>
              ) : (
                <div className="fin-expenses">
                  {filtered.map((e) => (
                    <div className="fin-expense" key={e.id}>
                      <div className="fin-expense-date">
                        <strong>{e.spent_on.slice(8, 10)}</strong>
                        <span>{MONTHS[Number(e.spent_on.slice(5, 7)) - 1].slice(0, 3)}</span>
                      </div>
                      <div className="fin-expense-main">
                        <strong>{e.name}</strong>
                        <span className="fin-expense-meta">
                          {e.category_id && <span className="fin-tag">{catName.get(e.category_id)}</span>}
                          {e.kind === 'fixed' && <span className="fin-tag fixed">Fijo</span>}
                          {e.supplier_name && <span className="muted">{e.supplier_name}</span>}
                          {e.note && <span className="muted">· {e.note}</span>}
                        </span>
                      </div>
                      <div className="fin-expense-paid">
                        {e.status === 'pending'
                          ? <Link to="/accounts" className="due-pill soon">Por pagar</Link>
                          : <span className="muted">{e.account_name || '—'}</span>}
                      </div>
                      <div className="fin-expense-amount">
                        <strong>{usd(e.amount_usd)}</strong>
                        {e.currency === 'VES' && <span className="muted">{bs(e.amount)}</span>}
                      </div>
                      <div className="fin-expense-actions">
                        {e.receipt_path && (
                          <button type="button" className="icon-btn" title="Ver comprobante" aria-label="Ver comprobante"
                            onClick={() => openReceipt(e.receipt_path)}>{ClipIcon}</button>
                        )}
                        <button type="button" className="btn ghost sm" onClick={() => setEditing(e)}>Editar</button>
                        <button type="button" className="btn ghost sm danger-text" onClick={() => onDelete(e)}>Borrar</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="card fin-board">
              <div className="fin-toolbar">
                <p className="muted fin-toolbar-note">
                  Alquiler, nómina, internet… Te avisamos antes de que venzan y los registras con un toque.
                </p>
                <button type="button" className="btn sm" onClick={() => setForm({ mode: 'new', fixed: true })}>+ Gasto fijo</button>
              </div>
              {recurring.length === 0 ? (
                <div className="fin-empty">
                  <p><strong>Todavía no tienes gastos fijos.</strong></p>
                  <p className="muted">Agrega los que se repiten cada mes y no se te pasa ninguno.</p>
                </div>
              ) : (
                <div className="fin-expenses">
                  {recurring.map((r) => {
                    const di = dueInfo(r.next_due, 5);
                    return (
                      <div className={`fin-expense${r.active ? '' : ' inactive'}`} key={r.id}>
                        <div className="fin-expense-main">
                          <strong>{r.name}</strong>
                          <span className="fin-expense-meta">
                            {r.category_id && <span className="fin-tag">{catName.get(r.category_id)}</span>}
                            <span className="muted">{FREQ_LABEL[r.frequency]}</span>
                            {!r.active && <span className="muted">· en pausa</span>}
                          </span>
                        </div>
                        <div className="fin-expense-paid">
                          {r.active && <span className={`due-pill ${di.tone}`}>{di.days !== null && di.days > 5 ? `Próximo: ${formatDate(r.next_due)}` : di.label}</span>}
                        </div>
                        <div className="fin-expense-amount">
                          <strong>{r.currency === 'USD' ? usd(r.amount) : bs(r.amount)}</strong>
                          {r.currency === 'VES' && rate.value > 0 && <span className="muted">≈ {usd(r.amount / rate.value)}</span>}
                        </div>
                        <div className="fin-expense-actions">
                          {r.active && (
                            <button type="button" className="btn primary sm" onClick={() => setForm({ mode: 'template', template: r })}>
                              Registrar pago
                            </button>
                          )}
                          <button type="button" className="btn ghost sm" onClick={() => setEditingFixed(r)}>Editar</button>
                          <button type="button" className="btn ghost sm danger-text" onClick={() => onDeleteFixed(r)}>Quitar</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="card fin-side">
          <h2>Por categoría</h2>
          {byCategory.length === 0 ? <p className="muted">Aquí verás en qué se va la plata.</p> : (
            <ul className="fin-bars">
              {byCategory.map((c) => (
                <li key={c.id} title={`${c.name}: ${usd(c.total)} (${Math.round((c.total / totals.all) * 100)}%)`}>
                  <button type="button" className={`fin-bar-row${category === c.id ? ' on' : ''}`}
                    onClick={() => { setCategory((x) => (x === c.id ? '' : c.id)); setTab('list'); }}>
                    <span className="fin-bar-label"><span>{c.name}</span><strong>{usd(c.total)}</strong></span>
                    <span className="fin-bar-track"><span className="fin-bar" style={{ width: `${maxCat ? Math.max(2, (c.total / maxCat) * 100) : 0}%` }} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sales !== null && (sales > 0 || totals.all > 0) && (
            <div className="fin-vs">
              <h3>Ventas frente a gastos</h3>
              <div className="fin-vs-row"><span>Ventas</span><strong>{usd(sales)}</strong></div>
              <div className="fin-vs-row"><span>Gastos</span><strong>− {usd(totals.all)}</strong></div>
              <div className={`fin-vs-row total${result < 0 ? ' late' : ''}`}>
                <span>{result < 0 ? 'Pérdida' : 'Te queda'}</span><strong>{usd(Math.abs(result))}</strong>
              </div>
              <p className="muted fin-vs-note">Ventas sin cancelar del período, ya con descuentos. No resta el costo de la mercancía vendida.</p>
            </div>
          )}
        </aside>
      </div>

      {form && (
        <ExpenseForm form={form} business={business} branchId={branchId} rate={rate}
          categories={categories} accounts={accounts} suppliers={suppliers} onNewCategory={onNewCategory}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await Promise.all([load(), loadRecurring()]); notifyCashChanged(); }} />
      )}
      {editing && (
        <ExpenseEdit expense={editing} business={business} categories={categories} onNewCategory={onNewCategory}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }} />
      )}
      {editingFixed && (
        <FixedEdit item={editingFixed} categories={categories} onNewCategory={onNewCategory}
          onClose={() => setEditingFixed(null)}
          onSaved={async () => { setEditingFixed(null); await loadRecurring(); }} />
      )}
    </div>
  );
}

// Selector de categoría con opción de crear una nueva sin salir del formulario.
function CategorySelect({ value, onChange, categories, onNewCategory }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  if (adding) {
    return (
      <div className="fin-amount-row">
        <input autoFocus value={name} placeholder="Nueva categoría" onChange={(e) => setName(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.nextSibling?.click(); }
            if (e.key === 'Escape') setAdding(false);
          }} />
        <button type="button" className="btn sm" disabled={!name.trim()} onClick={async () => {
          try { const c = await onNewCategory(name); onChange(c.id); setAdding(false); setName(''); }
          catch (e) { setErr(/duplicate|unique/i.test(e.message) ? 'Ya existe esa categoría' : e.message); }
        }}>Crear</button>
        <button type="button" className="btn ghost sm" onClick={() => setAdding(false)}>×</button>
        {err && <span className="fin-inline-err">{err}</span>}
      </div>
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

// ---------- Agregar gasto (variable, fijo o pago de un fijo) ----------
function ExpenseForm({ form, business, branchId, rate, categories, accounts, suppliers, onNewCategory, onClose, onSaved }) {
  const t = form.template;
  const today = localISO();
  const [f, setF] = useState(() => ({
    kind: t || form.fixed ? 'fixed' : 'variable',
    name: t?.name || '', categoryId: t?.category_id || '', supplierId: t?.supplier_id || '',
    amount: t ? String(t.amount) : '', currency: t?.currency || 'USD',
    rate: rate.value ? String(rate.value) : '',
    spentOn: today,
    accountId: accounts.find((a) => a.is_cash)?.id || accounts[0]?.id || PENDING,
    dueDate: addDays(today, 7),
    frequency: 'monthly', payNow: true, nextDue: nextDue(today, 'monthly'),
    note: '',
  }));
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  // La tasa llega después de abrir el formulario.
  useEffect(() => {
    if (rate.value) setF((x) => (x.rate ? x : { ...x, rate: String(rate.value) }));
  }, [rate.value]);

  const amt = num(f.amount);
  const r = num(f.rate);
  const amtUsd = f.currency === 'USD' ? amt : (r ? round2(amt / r) : 0);
  const amtVes = f.currency === 'VES' ? amt : round2(amt * r);
  const newFixed = f.kind === 'fixed' && !t;
  const registering = !newFixed || f.payNow;
  const account = accounts.find((a) => a.id === f.accountId);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      let recurringId = t?.id || null;
      if (newFixed) {
        const tpl = await createRecurringExpense(business.id, {
          name: f.name.trim(), category_id: f.categoryId || null, supplier_id: f.supplierId || null,
          amount: amt, currency: f.currency, frequency: f.frequency,
          // Si se registra el pago ahora, create_expense avanza la fecha; si no,
          // el primer aviso es la fecha elegida.
          next_due: f.payNow ? f.spentOn : f.nextDue, branch_id: branchId || null,
        });
        recurringId = f.payNow ? tpl.id : null;
      }
      if (registering) {
        const receipt = file ? await uploadExpenseReceipt(business.id, file) : '';
        await createExpense({
          kind: f.kind, name: f.name.trim(), category_id: f.categoryId || null, supplier_id: f.supplierId || null,
          amount: amt, currency: f.currency, rate: r, spent_on: f.spentOn,
          account_id: f.accountId === PENDING ? null : f.accountId,
          due_date: f.accountId === PENDING ? f.dueDate : null,
          note: f.note, receipt_path: receipt, branch_id: branchId || null, recurring_id: recurringId,
        });
      }
      await onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  const title = t ? `Pago de ${t.name}` : 'Agregar gasto';

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal card fin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={onClose}>Cerrar</button>
        </div>
        <form onSubmit={onSubmit} className="vform">
          {!t && (
            <div className="fin-choice">
              {[['variable', 'Variable', 'Una sola vez: un almuerzo, una reparación'], ['fixed', 'Fijo', 'Se repite: alquiler, nómina, internet']].map(([k, l, h]) => (
                <label key={k} className={`fin-choice-opt${f.kind === k ? ' on' : ''}`}>
                  <input type="radio" name="kind" checked={f.kind === k} onChange={() => setF((x) => ({ ...x, kind: k }))} />
                  <strong>{l}</strong><span className="muted">{h}</span>
                </label>
              ))}
            </div>
          )}

          <div className="fin-grid">
            <label>Nombre del gasto
              <input required value={f.name} onChange={set('name')} placeholder={f.kind === 'fixed' ? 'Alquiler del local' : 'Bolsas y empaques'} />
            </label>
            <label>Categoría
              <CategorySelect value={f.categoryId} onChange={(v) => setF((x) => ({ ...x, categoryId: v }))}
                categories={categories} onNewCategory={onNewCategory} />
            </label>
          </div>

          <label>Monto
            <div className="fin-money">
              <div className="seg sm">
                {['USD', 'VES'].map((c) => (
                  <button key={c} type="button" className={`seg-btn${f.currency === c ? ' active' : ''}`}
                    onClick={() => setF((x) => ({ ...x, currency: c }))}>{c === 'USD' ? '$' : 'Bs'}</button>
                ))}
              </div>
              <input required inputMode="decimal" placeholder="0,00" value={f.amount} onChange={set('amount')} />
            </div>
          </label>
          <div className="fin-rate">
            <span className="muted">
              {amt > 0 && (f.currency === 'USD' ? `≈ ${bs(amtVes)}` : `≈ ${usd(amtUsd)}`)}
            </span>
            <label className="fin-rate-input">Tasa
              <input inputMode="decimal" value={f.rate} onChange={set('rate')} />
              <span className="muted">Bs/$ {rate.value && num(f.rate) === rate.value ? `· ${rate.label}` : ''}</span>
            </label>
          </div>

          {newFixed && (
            <div className="fin-fixed-box">
              <div className="fin-grid">
                <label>Se paga
                  <select value={f.frequency} onChange={(e) => setF((x) => ({ ...x, frequency: e.target.value, nextDue: nextDue(x.spentOn, e.target.value) }))}>
                    {FREQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
                {!f.payNow && (
                  <label>Próximo pago
                    <input type="date" value={f.nextDue} onChange={set('nextDue')} />
                  </label>
                )}
              </div>
              <label className="fin-check">
                <input type="checkbox" checked={f.payNow} onChange={(e) => setF((x) => ({ ...x, payNow: e.target.checked }))} />
                Registrar ya el pago de este período
              </label>
              {f.payNow && <p className="hint">El próximo aviso será el {formatDate(nextDue(f.spentOn, f.frequency))}.</p>}
            </div>
          )}

          {registering && (
            <>
              <div className="fin-grid">
                <label>Fecha
                  <input type="date" value={f.spentOn} max={today} onChange={set('spentOn')} />
                </label>
                <label>Pagado con
                  <select value={f.accountId} onChange={set('accountId')}>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency === 'USD' ? '$' : 'Bs'}){a.is_cash ? ' · efectivo' : ''}</option>)}
                    <option value={PENDING}>Todavía no: queda por pagar</option>
                  </select>
                </label>
              </div>
              {f.accountId === PENDING ? (
                <label>¿Cuándo hay que pagarlo?
                  <input type="date" value={f.dueDate} onChange={set('dueDate')} required />
                  <span className="hint">Queda en Cuentas por pagar y se marca pagado cuando lo pagues ahí.</span>
                </label>
              ) : account?.is_cash && (
                <p className="hint">Sale del efectivo: si la caja está abierta, se descuenta del arqueo.</p>
              )}
              <div className="fin-grid">
                <label>Proveedor (opcional)
                  <select value={f.supplierId} onChange={set('supplierId')}>
                    <option value="">—</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label>Comprobante (opcional)
                  <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                </label>
              </div>
              <label>Nota (opcional)
                <input value={f.note} onChange={set('note')} placeholder="Factura 0045, pagado a Juan…" />
              </label>
            </>
          )}

          {error && <div className="form-error">{error}</div>}
          <div className="inline-form-actions">
            <button className="btn primary" disabled={busy || amt <= 0 || !f.name.trim() || (f.currency === 'VES' && !r)}>
              {busy ? 'Guardando…' : newFixed && !f.payNow ? 'Guardar gasto fijo' : 'Confirmar gasto'}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- Editar datos de un gasto (el monto y la cuenta no se tocan) ----------
function ExpenseEdit({ expense, business, categories, onNewCategory, onClose, onSaved }) {
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
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal card fin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Editar gasto</h2>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={onClose}>Cerrar</button>
        </div>
        <div className="fin-pay-summary">
          <span className="muted">{expense.status === 'pending' ? 'Por pagar' : `Pagado con ${expense.account_name || '—'}`}</span>
          <strong>{expense.currency === 'USD' ? usd(expense.amount) : bs(expense.amount)}</strong>
          <span className="muted">Para cambiar el monto o la cuenta, borra el gasto y regístralo de nuevo.</span>
        </div>
        <form onSubmit={onSubmit} className="vform">
          <label>Nombre <input required value={f.name} onChange={set('name')} /></label>
          <div className="fin-grid">
            <label>Categoría
              <CategorySelect value={f.categoryId} onChange={(v) => setF((x) => ({ ...x, categoryId: v }))}
                categories={categories} onNewCategory={onNewCategory} />
            </label>
            <label>Fecha <input type="date" value={f.spentOn} onChange={set('spentOn')} /></label>
          </div>
          <label>{expense.receipt_path ? 'Reemplazar comprobante' : 'Comprobante'}
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <label>Nota <input value={f.note} onChange={set('note')} /></label>
          {error && <div className="form-error">{error}</div>}
          <div className="inline-form-actions">
            <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
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
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal card fin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Gasto fijo</h2>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={onClose}>Cerrar</button>
        </div>
        <form onSubmit={onSubmit} className="vform">
          <label>Nombre <input required value={f.name} onChange={set('name')} /></label>
          <label>Categoría
            <CategorySelect value={f.categoryId} onChange={(v) => setF((x) => ({ ...x, categoryId: v }))}
              categories={categories} onNewCategory={onNewCategory} />
          </label>
          <label>Monto
            <div className="fin-money">
              <div className="seg sm">
                {['USD', 'VES'].map((c) => (
                  <button key={c} type="button" className={`seg-btn${f.currency === c ? ' active' : ''}`}
                    onClick={() => setF((x) => ({ ...x, currency: c }))}>{c === 'USD' ? '$' : 'Bs'}</button>
                ))}
              </div>
              <input required inputMode="decimal" value={f.amount} onChange={set('amount')} />
            </div>
          </label>
          <div className="fin-grid">
            <label>Se paga
              <select value={f.frequency} onChange={set('frequency')}>
                {FREQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label>Próximo pago <input type="date" value={f.nextDue} onChange={set('nextDue')} required /></label>
          </div>
          <label className="fin-check">
            <input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} />
            Activo (avisarme cuando venza)
          </label>
          {error && <div className="form-error">{error}</div>}
          <div className="inline-form-actions">
            <button className="btn primary" disabled={busy || num(f.amount) <= 0}>{busy ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
