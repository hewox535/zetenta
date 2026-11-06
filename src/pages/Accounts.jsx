import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { useConfirm } from '../components/Confirm';
import { FinModal, RowMenu, Toast, SortHead } from '../components/FinUI';
import { notifyCashChanged } from '../lib/cashEvents';
import {
  fetchDebts, createDebt, updateDebt, deleteDebt, payDebts, deleteDebtPayment,
  fetchBankAccounts, fetchCustomers, fetchSuppliers,
} from '../lib/api';
import { fetchBcvRates, resolveRate } from '../lib/rates';
import { usd, bs, formatDate } from '../lib/calc';
import { num, round2, localISO, addDays, dueInfo, downloadCsv, norm } from '../lib/finance';
import './finance.css';

const KIND = {
  receivable: {
    tab: 'Por cobrar', total: 'Total por cobrar', who: 'Cliente', whoHead: 'Quién te debe',
    action: 'Cobrar', actionAll: 'Cobrar todo', verb: 'Cobro', done: 'Cobro registrado',
    parties: (n) => (n === 1 ? '1 cliente con saldo' : `${n} clientes con saldo`),
  },
  payable: {
    tab: 'Por pagar', total: 'Total por pagar', who: 'Proveedor', whoHead: 'A quién le debes',
    action: 'Pagar', actionAll: 'Pagar todo', verb: 'Pago', done: 'Pago registrado',
    parties: (n) => (n === 1 ? '1 acreedor' : `${n} acreedores`),
  },
};
const PARTY_LABEL = { customer: 'Cliente', supplier: 'Proveedor', other: 'Otro' };
const FILTERS = [['all', 'Todas'], ['late', 'Vencidas'], ['soon', 'Próximos 7 días'], ['nodate', 'Sin fecha']];

const balanceOf = (d) => round2(Number(d.amount_usd) - Number(d.paid_usd));
const isOpen = (d) => balanceOf(d) > 0.004;
const partyKey = (d) => `${d.party_type}:${d.customer_id || d.supplier_id || norm(d.party_name)}`;
const initials = (name) => name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·';

const Chevron = (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
);

export default function Accounts() {
  const { business } = useAuth();
  const { branchId } = useBranch();
  const ask = useConfirm();

  const [debts, setDebts] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [rate, setRate] = useState({ value: 0 });
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const [kind, setKind] = useState('receivable');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showSettled, setShowSettled] = useState(false);
  const [sort, setSort] = useState({ key: 'due', dir: 'asc' });
  const [expanded, setExpanded] = useState(() => new Set());

  const [creating, setCreating] = useState(null);
  const [editing, setEditing] = useState(null);
  const [paying, setPaying] = useState(null);       // { name, kind, debts }

  const load = useCallback(async () => {
    try { setDebts(await fetchDebts()); }
    catch (e) { setError(e.message); setDebts([]); }
  }, []);

  useEffect(() => {
    load();
    fetchBankAccounts().then((a) => setAccounts(a.filter((x) => x.active))).catch(() => {});
    fetchCustomers().then(setCustomers).catch(() => {});
    fetchSuppliers().then(setSuppliers).catch(() => {});
  }, [load]);
  useEffect(() => {
    fetchBcvRates().then((r) => setRate(resolveRate(business?.rate_config, r))).catch(() => {});
  }, [business]);

  const meta = KIND[kind];

  // ---------- resumen de la pestaña ----------
  const counts = useMemo(() => ({
    receivable: (debts || []).filter((d) => d.kind === 'receivable' && isOpen(d)).length,
    payable: (debts || []).filter((d) => d.kind === 'payable' && isOpen(d)).length,
  }), [debts]);

  const kpis = useMemo(() => {
    const open = (debts || []).filter((d) => d.kind === kind && isOpen(d));
    const sum = (l) => round2(l.reduce((s, d) => s + balanceOf(d), 0));
    const late = open.filter((d) => dueInfo(d.due_date).tone === 'late');
    const week = open.filter((d) => { const n = dueInfo(d.due_date).days; return n !== null && n >= 0 && n <= 7; });
    return {
      total: sum(open), parties: new Set(open.map(partyKey)).size,
      late: sum(late), lateN: late.length, week: sum(week), weekN: week.length,
    };
  }, [debts, kind]);

  // ---------- lista agrupada por contraparte ----------
  const groups = useMemo(() => {
    const q = norm(search.trim());
    const list = (debts || []).filter((d) => {
      if (d.kind !== kind) return false;
      if (!showSettled && !isOpen(d)) return false;
      const info = dueInfo(d.due_date);
      if (filter === 'late' && (!isOpen(d) || info.tone !== 'late')) return false;
      if (filter === 'soon' && (!isOpen(d) || info.days === null || info.days < 0 || info.days > 7)) return false;
      if (filter === 'nodate' && d.due_date) return false;
      if (q) {
        const hay = norm([d.party_name, d.concept, d.note, d.orders?.number, d.expenses?.name].join(' '));
        if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
      }
      return true;
    });
    const map = new Map();
    list.forEach((d) => {
      const k = partyKey(d);
      if (!map.has(k)) map.set(k, { key: k, name: d.party_name, type: d.party_type, debts: [] });
      map.get(k).debts.push(d);
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...map.values()].map((g) => {
      const pending = g.debts.filter(isOpen);
      return {
        ...g,
        pending,
        balance: round2(pending.reduce((s, d) => s + balanceOf(d), 0)),
        total: round2(g.debts.reduce((s, d) => s + Number(d.amount_usd), 0)),
        paid: round2(g.debts.reduce((s, d) => s + Number(d.paid_usd), 0)),
        next: pending.map((d) => d.due_date).filter(Boolean).sort()[0] || null,
      };
    }).sort((a, b) => {
      if (!a.balance !== !b.balance) return a.balance ? -1 : 1;   // saldadas al final
      if (sort.key === 'name') return dir * a.name.localeCompare(b.name);
      if (sort.key === 'count') return dir * (a.pending.length - b.pending.length);
      if (sort.key === 'balance') return dir * (a.balance - b.balance);
      if (a.next === b.next) return b.balance - a.balance;
      if (!a.next) return 1;
      if (!b.next) return -1;
      return dir * a.next.localeCompare(b.next);
    });
  }, [debts, kind, filter, search, showSettled, sort]);

  const listTotal = round2(groups.reduce((s, g) => s + g.balance, 0));
  const toggle = (k) => setExpanded((prev) => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const filtering = filter !== 'all' || search.trim();

  // ---------- acciones ----------
  async function onDelete(d) {
    if (!await ask({
      title: '¿Borrar esta cuenta?',
      message: `${d.party_name} · ${d.concept || 'Sin concepto'} · ${usd(d.amount_usd)}`,
      confirmLabel: 'Borrar',
    })) return;
    try { await deleteDebt(d.id); await load(); setToast({ text: 'Cuenta borrada' }); }
    catch (e) { setError(e.message); }
  }

  async function onDeletePayment(p, d) {
    if (!await ask({
      title: `¿Deshacer este ${d.kind === 'receivable' ? 'cobro' : 'pago'}?`,
      message: `${p.currency === 'USD' ? usd(p.amount) : bs(p.amount)} por ${p.account_name} del ${formatDate(p.created_at)}. El saldo vuelve a quedar pendiente.`,
      confirmLabel: 'Deshacer',
    })) return;
    try { await deleteDebtPayment(p.id); await load(); notifyCashChanged(); setToast({ text: `${KIND[d.kind].verb} deshecho` }); }
    catch (e) { setError(e.message); }
  }

  function exportCsv() {
    const rows = [['Tipo', 'Contraparte', 'Es', 'Concepto', 'Fecha', 'Vence', 'Monto USD', 'Abonado USD', 'Saldo USD', 'Estado']];
    groups.forEach((g) => g.debts.forEach((d) => rows.push([
      KIND[d.kind].tab, d.party_name, PARTY_LABEL[d.party_type], d.concept,
      formatDate(d.issue_date), formatDate(d.due_date), Number(d.amount_usd).toFixed(2),
      Number(d.paid_usd).toFixed(2), balanceOf(d).toFixed(2),
      isOpen(d) ? dueInfo(d.due_date).label : 'Saldada',
    ])));
    downloadCsv(`cuentas-${kind === 'receivable' ? 'por-cobrar' : 'por-pagar'}-${localISO()}.csv`, rows);
  }

  return (
    <div className="page fin-page">
      <header className="page-head">
        <div>
          <h1>Cuentas por cobrar y pagar</h1>
          <p className="page-sub">Quién te debe, a quién le debes, cuánto y cuándo vence.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn ghost" onClick={exportCsv} disabled={!groups.length}>Exportar</button>
          <button type="button" className="btn primary" onClick={() => setCreating({ kind })}>+ Nueva cuenta</button>
        </div>
      </header>

      {error && <div className="form-error" onClick={() => setError(null)}>{error}</div>}

      <div className="fin-tabs-row">
        <div className="fin-tabs" role="tablist">
          {Object.entries(KIND).map(([k, m]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k}
              className={`fin-tab${kind === k ? ' active' : ''}`}
              onClick={() => { setKind(k); setExpanded(new Set()); }}>
              {m.tab}{counts[k] > 0 && <span className="fin-tab-count">{counts[k]}</span>}
            </button>
          ))}
        </div>
        <label className="fin-check">
          <input type="checkbox" checked={!showSettled} onChange={(e) => setShowSettled(!e.target.checked)} />
          Ocultar saldadas
        </label>
      </div>

      <div className="fin-kpis">
        <div className="card fin-kpi">
          <span className="fin-kpi-label">{meta.total}</span>
          <strong className="fin-kpi-value">{usd(kpis.total)}</strong>
          <span className="fin-kpi-sub">{rate.value ? bs(kpis.total * rate.value) : meta.parties(kpis.parties)}</span>
        </div>
        <button type="button" className={`card fin-kpi${filter === 'late' ? ' active' : ''}`}
          onClick={() => setFilter((f) => (f === 'late' ? 'all' : 'late'))}>
          <span className="fin-kpi-label"><i className="fin-dot late" />Vencido</span>
          <strong className={`fin-kpi-value${kpis.late > 0 ? ' late' : ''}`}>{usd(kpis.late)}</strong>
          <span className="fin-kpi-sub">{kpis.lateN === 0 ? 'Nada vencido' : kpis.lateN === 1 ? '1 cuenta vencida' : `${kpis.lateN} cuentas vencidas`}</span>
        </button>
        <button type="button" className={`card fin-kpi${filter === 'soon' ? ' active' : ''}`}
          onClick={() => setFilter((f) => (f === 'soon' ? 'all' : 'soon'))}>
          <span className="fin-kpi-label"><i className="fin-dot soon" />Próximos 7 días</span>
          <strong className="fin-kpi-value">{usd(kpis.week)}</strong>
          <span className="fin-kpi-sub">{kpis.weekN === 0 ? 'Nada por vencer' : kpis.weekN === 1 ? '1 cuenta por vencer' : `${kpis.weekN} cuentas por vencer`}</span>
        </button>
        <div className="card fin-kpi">
          <span className="fin-kpi-label">{kind === 'receivable' ? 'Clientes' : 'Acreedores'}</span>
          <strong className="fin-kpi-value">{kpis.parties}</strong>
          <span className="fin-kpi-sub">{kind === 'receivable' ? 'con saldo pendiente' : 'a los que les debes'}</span>
        </div>
      </div>

      <div className="card fin-board">
        <div className="fin-toolbar">
          <div className="fin-search-wrap">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            <input type="search" className="fin-search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={kind === 'receivable' ? 'Buscar cliente, venta o concepto' : 'Buscar proveedor, gasto o concepto'} />
          </div>
          <div className="chip-row">
            {FILTERS.map(([k, label]) => (
              <button key={k} type="button" className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          <span className="fin-total">Total: <strong>{usd(listTotal)}</strong></span>
        </div>

        {debts === null ? (
          <div className="fin-empty"><span className="muted">Cargando…</span></div>
        ) : groups.length === 0 ? (
          <div className="fin-empty">
            <div className="fin-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26"><path d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <p className="fin-empty-title">{filtering ? 'Nada coincide con la búsqueda' : kind === 'receivable' ? 'Nadie te debe nada' : 'No le debes nada a nadie'}</p>
            <p className="muted">
              {filtering ? 'Prueba con otro filtro o búsqueda.'
                : kind === 'receivable'
                  ? 'Las ventas a crédito aparecen aquí solas. También puedes anotar un préstamo o un adelanto.'
                  : 'Los gastos que quedan por pagar aparecen aquí solos. También puedes anotar una compra a crédito.'}
            </p>
            {filtering
              ? <button type="button" className="btn" onClick={() => { setFilter('all'); setSearch(''); }}>Quitar filtros</button>
              : <button type="button" className="btn" onClick={() => setCreating({ kind })}>+ Nueva cuenta {kind === 'receivable' ? 'por cobrar' : 'por pagar'}</button>}
          </div>
        ) : (
          <div className="fin-table" role="table">
            <div className="fin-grid-row fin-thead" role="row">
              <span />
              <SortHead label={meta.whoHead} k="name" sort={sort} setSort={setSort} />
              <SortHead label="Cuentas" k="count" sort={sort} setSort={setSort} align="right" />
              <SortHead label="Saldo" k="balance" sort={sort} setSort={setSort} align="right" />
              <SortHead label="Vencimiento" k="due" sort={sort} setSort={setSort} />
              <span className="fin-th-right">{meta.action}</span>
            </div>

            {groups.map((g) => {
              const open = expanded.has(g.key);
              const info = g.balance > 0 ? dueInfo(g.next) : null;
              return (
                <div className={`fin-group${open ? ' open' : ''}`} key={g.key}>
                  <div className="fin-grid-row fin-party-row" role="row" onClick={() => toggle(g.key)}
                    aria-expanded={open} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(g.key); } }}>
                    <span className="fin-chev" aria-hidden="true">{Chevron}</span>
                    <span className="fin-party">
                      <span className="fin-avatar" aria-hidden="true">{initials(g.name)}</span>
                      <span className="fin-party-text">
                        <strong>{g.name}</strong>
                        <span>{PARTY_LABEL[g.type]}{g.paid > 0 && g.balance > 0 ? ` · abonó ${usd(g.paid)}` : ''}</span>
                      </span>
                    </span>
                    <span className="fin-cell-num fin-muted-cell" data-label="Cuentas">{g.pending.length || g.debts.length}</span>
                    <span className="fin-cell-num fin-strong" data-label="Saldo">
                      {g.balance > 0 ? usd(g.balance) : <span className="due-pill done">Saldada</span>}
                    </span>
                    <span className="fin-cell-due">{info && <span className={`due-pill ${info.tone}`}>{info.label}</span>}</span>
                    <span className="fin-cell-actions" onClick={(e) => e.stopPropagation()}>
                      {g.balance > 0 && (
                        <button type="button" className="btn primary sm fin-pay-btn"
                          onClick={() => setPaying({ name: g.name, kind, debts: g.pending })}>
                          {g.pending.length > 1 ? meta.actionAll : meta.action}
                        </button>
                      )}
                    </span>
                  </div>

                  {open && (
                    <div className="fin-sub" role="rowgroup">
                      {g.debts.map((d) => {
                        const bal = balanceOf(d);
                        const di = dueInfo(d.due_date);
                        const pays = [...(d.debt_payments || [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
                        const deletable = !d.order_id && !d.expense_id && pays.length === 0;
                        return (
                          <Fragment key={d.id}>
                            <div className={`fin-grid-row fin-debt-row${bal <= 0.004 ? ' settled' : ''}`} role="row">
                              <span />
                              <span className="fin-debt-main">
                                <strong>
                                  {d.order_id
                                    ? <Link to={`/orders/${d.order_id}`}>{d.concept || `Venta Nº ${d.orders?.number}`}</Link>
                                    : d.concept || 'Sin concepto'}
                                </strong>
                                <span>
                                  {formatDate(d.issue_date)}
                                  {d.expense_id && ' · desde Gastos'}
                                  {d.note && ` · ${d.note}`}
                                </span>
                              </span>
                              <span className="fin-cell-num fin-muted-cell" data-label="Monto">
                                {Number(d.paid_usd) > 0 ? <>{usd(d.amount_usd)}<small>abonado {usd(d.paid_usd)}</small></> : usd(d.amount_usd)}
                              </span>
                              <span className="fin-cell-num" data-label="Saldo">{bal > 0.004 ? usd(bal) : '—'}</span>
                              <span className="fin-cell-due">
                                {bal > 0.004 ? <span className={`due-pill ${di.tone}`}>{di.label}</span> : <span className="due-pill done">Saldada</span>}
                              </span>
                              <span className="fin-cell-actions">
                                {bal > 0.004 && (
                                  <button type="button" className="btn sm" onClick={() => setPaying({ name: g.name, kind, debts: [d] })}>
                                    {meta.action}
                                  </button>
                                )}
                                <RowMenu items={[
                                  { label: 'Editar', onClick: () => setEditing(d) },
                                  { label: 'Borrar', onClick: () => onDelete(d), danger: true, hidden: !deletable },
                                ]} />
                              </span>
                            </div>
                            {pays.map((p) => (
                              <div className="fin-grid-row fin-pay-row" role="row" key={p.id}>
                                <span />
                                <span className="fin-pay-text">
                                  <i aria-hidden="true" />
                                  {meta.verb} del {formatDate(p.created_at)} · {p.account_name}
                                  {p.note && <span className="muted"> · {p.note}</span>}
                                </span>
                                <span />
                                <span className="fin-cell-num fin-pay-amount">
                                  −{usd(p.amount_usd)}
                                  {p.currency === 'VES' && <small>{bs(p.amount)}</small>}
                                </span>
                                <span />
                                <span className="fin-cell-actions">
                                  <button type="button" className="btn ghost sm" onClick={() => onDeletePayment(p, d)}>Deshacer</button>
                                </span>
                              </div>
                            ))}
                          </Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {creating && (
        <DebtForm initial={creating} customers={customers} suppliers={suppliers} branchId={branchId} rate={rate}
          onClose={() => setCreating(null)}
          onSaved={async (d) => {
            setCreating(null); setKind(d.kind); await load();
            setExpanded(new Set([partyKey(d)]));
            setToast({ text: 'Cuenta creada', sub: `${d.party_name} · ${usd(d.amount_usd)}` });
          }} />
      )}
      {editing && (
        <DebtEdit debt={editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); setToast({ text: 'Cambios guardados' }); }} />
      )}
      {paying && (
        <PayModal target={paying} accounts={accounts} rate={rate}
          onClose={() => setPaying(null)}
          onPaid={async (paidUsd) => {
            const m = KIND[paying.kind];
            setPaying(null); await load(); notifyCashChanged();
            setToast({ text: m.done, sub: `${usd(paidUsd)} · ${paying.name}` });
          }} />
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

// ---------- Nueva cuenta ----------
function DebtForm({ initial, customers, suppliers, branchId, rate, onClose, onSaved }) {
  const today = localISO();
  const [f, setF] = useState({
    kind: initial.kind, partyType: initial.kind === 'receivable' ? 'customer' : 'supplier',
    partyId: '', partyName: '', concept: '', amount: '', currency: 'USD',
    issueDate: today, dueDate: addDays(today, 15), note: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const parties = f.partyType === 'customer' ? customers : f.partyType === 'supplier' ? suppliers : [];
  const amt = num(f.amount);
  const amtUsd = f.currency === 'USD' ? amt : (rate.value ? round2(amt / rate.value) : 0);
  const valid = amtUsd > 0 && (f.partyType === 'other' ? f.partyName.trim() : f.partyId);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const d = await createDebt({
        kind: f.kind, partyType: f.partyType,
        customerId: f.partyType === 'customer' ? f.partyId : null,
        supplierId: f.partyType === 'supplier' ? f.partyId : null,
        partyName: f.partyName, concept: f.concept, amountUsd: amtUsd,
        issueDate: f.issueDate, dueDate: f.dueDate || null, note: f.note, branchId,
      });
      await onSaved(d);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  const dueChips = [[7, '7 días'], [15, '15 días'], [30, '30 días']];

  return (
    <FinModal title="Nueva cuenta" onClose={onClose} busy={busy} onSubmit={onSubmit}
      footer={(
        <>
          <span className="fm-foot-note">{amt > 0 && f.currency === 'VES' && rate.value ? `Se guarda en dólares: ${usd(amtUsd)}` : ''}</span>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || !valid}>{busy ? 'Guardando…' : 'Guardar cuenta'}</button>
        </>
      )}>
      <div className="fin-choice">
        {Object.entries(KIND).map(([k, m]) => (
          <label key={k} className={`fin-choice-opt${f.kind === k ? ' on' : ''}`}>
            <input type="radio" name="kind" checked={f.kind === k}
              onChange={() => setF((x) => ({ ...x, kind: k, partyType: k === 'receivable' ? 'customer' : 'supplier', partyId: '' }))} />
            <span className="fin-radio" aria-hidden="true" />
            <span className="fin-choice-text">
              <strong>{m.tab}</strong>
              <span>{k === 'receivable' ? 'Alguien te debe' : 'Tú le debes a alguien'}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="fm-field">
        <span className="fm-label">{f.kind === 'receivable' ? '¿Quién te debe?' : '¿A quién le debes?'}</span>
        <div className="seg sm fm-seg">
          {[['customer', 'Cliente'], ['supplier', 'Proveedor'], ['other', 'Otro']].map(([k, l]) => (
            <button key={k} type="button" className={`seg-btn${f.partyType === k ? ' active' : ''}`}
              onClick={() => setF((x) => ({ ...x, partyType: k, partyId: '' }))}>{l}</button>
          ))}
        </div>
        {f.partyType === 'other' ? (
          <input required value={f.partyName} onChange={set('partyName')} placeholder="Nombre: un empleado, un socio…" aria-label="Nombre" />
        ) : (
          <select required value={f.partyId} onChange={set('partyId')} aria-label={f.partyType === 'customer' ? 'Cliente' : 'Proveedor'}>
            <option value="">{parties.length ? `Elige el ${f.partyType === 'customer' ? 'cliente' : 'proveedor'}…` : `No hay ${f.partyType === 'customer' ? 'clientes' : 'proveedores'} registrados`}</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {f.partyType !== 'other' && parties.length === 0 && (
          <span className="fm-help">
            Agrégalos en <Link to={f.partyType === 'customer' ? '/customers' : '/suppliers'} onClick={onClose}>
              {f.partyType === 'customer' ? 'Clientes' : 'Proveedores'}</Link> o elige “Otro”.
          </span>
        )}
      </div>

      <label>Concepto
        <input value={f.concept} onChange={set('concept')}
          placeholder={f.kind === 'receivable' ? 'Préstamo, adelanto de sueldo…' : 'Compra de mercancía, factura 0012…'} />
      </label>

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
            <input required inputMode="decimal" placeholder="0,00" value={f.amount} onChange={set('amount')} aria-label="Monto" />
          </div>
        </div>
        <label>Fecha
          <input type="date" value={f.issueDate} onChange={set('issueDate')} />
        </label>
      </div>

      <div className="fm-field">
        <span className="fm-label">Vence</span>
        <div className="fm-due">
          <input type="date" value={f.dueDate} min={f.issueDate} onChange={set('dueDate')} aria-label="Fecha de vencimiento" />
          <div className="chip-row">
            {dueChips.map(([n, l]) => (
              <button type="button" key={n} className={`chip${f.dueDate === addDays(f.issueDate, n) ? ' on' : ''}`}
                onClick={() => setF((x) => ({ ...x, dueDate: addDays(x.issueDate, n) }))}>{l}</button>
            ))}
            <button type="button" className={`chip${!f.dueDate ? ' on' : ''}`} onClick={() => setF((x) => ({ ...x, dueDate: '' }))}>Sin fecha</button>
          </div>
        </div>
      </div>

      <label><span className="fm-label">Nota <span className="fm-optional">(opcional)</span></span>
        <input value={f.note} onChange={set('note')} />
      </label>
      {error && <div className="form-error">{error}</div>}
    </FinModal>
  );
}

// ---------- Editar ----------
function DebtEdit({ debt, onClose, onSaved }) {
  const [f, setF] = useState({
    concept: debt.concept, amount: String(debt.amount_usd), dueDate: debt.due_date || '', note: debt.note,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const locked = !!debt.order_id || !!debt.expense_id;

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await updateDebt(debt.id, { concept: f.concept, amountUsd: num(f.amount), dueDate: f.dueDate || null, note: f.note });
      await onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <FinModal title="Editar cuenta" sub={`${debt.party_name} · ${KIND[debt.kind].tab.toLowerCase()}`}
      onClose={onClose} busy={busy} onSubmit={onSubmit}
      footer={(
        <>
          <span className="fm-foot-note" />
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || num(f.amount) <= 0}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <label>Concepto <input value={f.concept} onChange={set('concept')} /></label>
      <div className="fm-grid">
        <label>Monto en dólares
          <input inputMode="decimal" value={f.amount} onChange={set('amount')} disabled={locked} />
          {locked && <span className="fm-help">Viene de {debt.order_id ? 'la venta' : 'un gasto'}; no se cambia aquí.</span>}
        </label>
        <label>Vence
          <input type="date" value={f.dueDate} onChange={set('dueDate')} />
        </label>
      </div>
      <label><span className="fm-label">Nota <span className="fm-optional">(opcional)</span></span><input value={f.note} onChange={set('note')} /></label>
      {error && <div className="form-error">{error}</div>}
    </FinModal>
  );
}

// ---------- Cobrar / pagar ----------
// Se puede abonar una parte. Con varias cuentas, se eligen cuáles; el monto se
// reparte de la que vence primero a la última.
function PayModal({ target, accounts, rate, onClose, onPaid }) {
  const meta = KIND[target.kind];
  const [picked, setPicked] = useState(() => new Set(target.debts.map((d) => d.id)));
  const chosen = target.debts.filter((d) => picked.has(d.id));
  const balance = round2(chosen.reduce((s, d) => s + balanceOf(d), 0));

  const [accountId, setAccountId] = useState(() => accounts.find((a) => a.is_cash)?.id || accounts[0]?.id || '');
  const account = accounts.find((a) => a.id === accountId);
  const ves = account?.currency === 'VES';
  const fullIn = (isVes, usdAmount) => (isVes ? round2(usdAmount * (rate.value || 0)) : usdAmount);
  const [amount, setAmount] = useState(() => fullIn(ves, balance).toFixed(2));
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Mientras no se escriba un monto a mano, sigue al saldo elegido y a la moneda.
  useEffect(() => {
    if (!touched) setAmount(fullIn(ves, balance).toFixed(2));
  }, [ves, balance]); // eslint-disable-line react-hooks/exhaustive-deps

  const amt = num(amount);
  const amtUsd = ves ? (rate.value ? round2(amt / rate.value) : 0) : amt;
  const rest = round2(balance - amtUsd);
  const over = amtUsd - balance > 0.01;

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const paid = await payDebts(chosen.map((d) => d.id), accountId, amt, rate.value, note);
      await onPaid(Number(paid) || amtUsd);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  const togglePick = (id) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) { if (n.size > 1) n.delete(id); } else n.add(id);
    return n;
  });

  return (
    <FinModal title={`${meta.verb} ${target.kind === 'receivable' ? 'de' : 'a'} ${target.name}`}
      onClose={onClose} busy={busy} onSubmit={onSubmit}
      footer={(
        <>
          <span className={`fm-foot-note${over ? ' bad' : ''}`}>
            {over ? `Supera el saldo por ${usd(amtUsd - balance)}`
              : amt <= 0 ? '' : rest > 0.004 ? `Abono parcial · quedan ${usd(rest)}` : 'Salda la cuenta'}
          </span>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || !accountId || amt <= 0 || over || (ves && !rate.value)}>
            {busy ? 'Guardando…' : `Confirmar ${meta.verb.toLowerCase()}`}
          </button>
        </>
      )}>
      <div className="fin-pay-summary">
        <span>Saldo {chosen.length > 1 ? `de ${chosen.length} cuentas` : 'pendiente'}</span>
        <strong>{usd(balance)}</strong>
        {rate.value > 0 && <span>{bs(balance * rate.value)} · tasa {bs(rate.value)}</span>}
      </div>

      {target.debts.length > 1 && (
        <div className="fin-pick">
          {target.debts.map((d) => {
            const di = dueInfo(d.due_date);
            return (
              <label key={d.id} className={`fin-pick-row${picked.has(d.id) ? ' on' : ''}`}>
                <input type="checkbox" checked={picked.has(d.id)} onChange={() => togglePick(d.id)} />
                <span className="fin-pick-main">
                  <strong>{d.concept || 'Sin concepto'}</strong>
                  <span className={`due-text ${di.tone}`}>{di.label}</span>
                </span>
                <span className="fin-pick-amount">{usd(balanceOf(d))}</span>
              </label>
            );
          })}
        </div>
      )}

      <div className="fm-grid">
        <label>{target.kind === 'receivable' ? 'Entra por' : 'Sale de'}
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
            {accounts.length === 0 && <option value="">Crea una cuenta en Negocio → Cuentas</option>}
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency === 'USD' ? '$' : 'Bs'}</option>)}
          </select>
        </label>
        <div className="fm-field">
          <span className="fm-label">Monto</span>
          <div className="fm-input-affix">
            <input inputMode="decimal" value={amount} required aria-label="Monto"
              onChange={(e) => { setTouched(true); setAmount(e.target.value); }} />
            <span>{ves ? 'Bs' : '$'}</span>
          </div>
          <span className="fm-help">
            {ves && amt > 0 ? `= ${usd(amtUsd)} · ` : ''}
            <button type="button" className="fm-link" onClick={() => { setTouched(false); setAmount(fullIn(ves, balance).toFixed(2)); }}>Todo</button>
            {' · '}
            <button type="button" className="fm-link" onClick={() => { setTouched(true); setAmount(fullIn(ves, round2(balance / 2)).toFixed(2)); }}>La mitad</button>
          </span>
        </div>
      </div>
      {account?.is_cash && <p className="fm-note">Es efectivo: {target.kind === 'receivable' ? 'entra a' : 'sale de'} la caja si está abierta.</p>}

      <label><span className="fm-label">Comentario <span className="fm-optional">(opcional)</span></span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Referencia, número de transferencia…" />
      </label>
      {error && <div className="form-error">{error}</div>}
    </FinModal>
  );
}
