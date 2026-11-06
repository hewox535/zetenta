import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { useConfirm } from '../components/Confirm';
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
  receivable: { tab: 'Por cobrar', party: 'Te deben', action: 'Cobrar', actionAll: 'Cobrar todo', verb: 'Cobro', new: 'Nueva cuenta por cobrar' },
  payable: { tab: 'Por pagar', party: 'Debes', action: 'Pagar', actionAll: 'Pagar todo', verb: 'Pago', new: 'Nueva cuenta por pagar' },
};
const PARTY_LABEL = { customer: 'Cliente', supplier: 'Proveedor', other: 'Otro' };
const FILTERS = [
  ['all', 'Todas'],
  ['late', 'Vencidas'],
  ['soon', 'Vencen en 7 días'],
  ['nodate', 'Sin fecha'],
];

const balanceOf = (d) => round2(Number(d.amount_usd) - Number(d.paid_usd));
const partyKey = (d) => `${d.party_type}:${d.customer_id || d.supplier_id || norm(d.party_name)}`;
const lateLabel = (n, kind) => {
  const what = kind === 'receivable' ? 'por cobrar' : 'por pagar';
  return n === 0 ? `Nada vencido ${what}` : `${n} ${n === 1 ? 'cuenta vencida' : 'cuentas vencidas'} ${what}`;
};
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

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

  const [kind, setKind] = useState('receivable');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showSettled, setShowSettled] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());

  const [creating, setCreating] = useState(null);   // formulario de nueva cuenta
  const [editing, setEditing] = useState(null);     // deuda en edición
  const [paying, setPaying] = useState(null);       // { name, debts: [...] }

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

  // ---------- resumen ----------
  const open = useMemo(() => (debts || []).filter((d) => balanceOf(d) > 0.004), [debts]);
  const kpis = useMemo(() => {
    const sum = (list) => round2(list.reduce((s, d) => s + balanceOf(d), 0));
    const rec = open.filter((d) => d.kind === 'receivable');
    const pay = open.filter((d) => d.kind === 'payable');
    const late = (list) => list.filter((d) => dueInfo(d.due_date).tone === 'late');
    const week = open.filter((d) => { const n = dueInfo(d.due_date).days; return n !== null && n >= 0 && n <= 7; });
    return {
      rec: sum(rec), recParties: new Set(rec.map(partyKey)).size,
      recLate: sum(late(rec)), recLateN: late(rec).length,
      pay: sum(pay), payParties: new Set(pay.map(partyKey)).size,
      payLate: sum(late(pay)), payLateN: late(pay).length,
      weekRec: sum(week.filter((d) => d.kind === 'receivable')),
      weekPay: sum(week.filter((d) => d.kind === 'payable')),
      counts: { receivable: rec.length, payable: pay.length },
    };
  }, [open]);

  // ---------- lista agrupada por contraparte ----------
  const groups = useMemo(() => {
    const q = norm(search.trim());
    const list = (debts || []).filter((d) => {
      if (d.kind !== kind) return false;
      const bal = balanceOf(d);
      if (!showSettled && bal <= 0.004) return false;
      const info = dueInfo(d.due_date);
      if (filter === 'late' && (bal <= 0.004 || info.tone !== 'late')) return false;
      if (filter === 'soon' && (bal <= 0.004 || info.days === null || info.days < 0 || info.days > 7)) return false;
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
    return [...map.values()].map((g) => {
      const pending = g.debts.filter((d) => balanceOf(d) > 0.004);
      const next = pending.filter((d) => d.due_date).map((d) => d.due_date).sort()[0] || null;
      return {
        ...g,
        pending,
        balance: round2(pending.reduce((s, d) => s + balanceOf(d), 0)),
        total: round2(g.debts.reduce((s, d) => s + Number(d.amount_usd), 0)),
        next,
      };
    }).sort((a, b) => {
      // Primero lo vencido / más próximo; lo saldado al final.
      if (!a.balance !== !b.balance) return a.balance ? -1 : 1;
      if (a.next && b.next) return a.next.localeCompare(b.next);
      if (a.next !== b.next) return a.next ? -1 : 1;
      return b.balance - a.balance;
    });
  }, [debts, kind, filter, search, showSettled]);

  const listTotal = round2(groups.reduce((s, g) => s + g.balance, 0));
  const meta = KIND[kind];

  const toggle = (k) => setExpanded((prev) => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  // ---------- acciones ----------
  async function onDelete(d) {
    if (!await ask({
      title: '¿Borrar esta cuenta?',
      message: `${d.party_name} · ${d.concept || 'Sin concepto'} · ${usd(d.amount_usd)}`,
      confirmLabel: 'Borrar',
    })) return;
    try { await deleteDebt(d.id); await load(); }
    catch (e) { setError(e.message); }
  }

  async function onDeletePayment(p, d) {
    if (!await ask({
      title: `¿Borrar este ${d.kind === 'receivable' ? 'cobro' : 'pago'}?`,
      message: `${p.currency === 'USD' ? usd(p.amount) : bs(p.amount)} por ${p.account_name} el ${formatDate(p.created_at)}. El saldo vuelve a quedar pendiente.`,
      confirmLabel: 'Borrar',
    })) return;
    try { await deleteDebtPayment(p.id); await load(); notifyCashChanged(); }
    catch (e) { setError(e.message); }
  }

  function exportCsv() {
    const rows = [['Tipo', 'Contraparte', 'Tipo de contraparte', 'Concepto', 'Emitida', 'Vence', 'Monto USD', 'Abonado USD', 'Saldo USD', 'Estado']];
    groups.forEach((g) => g.debts.forEach((d) => rows.push([
      KIND[d.kind].tab, d.party_name, PARTY_LABEL[d.party_type], d.concept,
      formatDate(d.issue_date), formatDate(d.due_date), Number(d.amount_usd).toFixed(2),
      Number(d.paid_usd).toFixed(2), balanceOf(d).toFixed(2),
      balanceOf(d) <= 0.004 ? 'Saldada' : dueInfo(d.due_date).label,
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

      <div className="fin-kpis">
        <button type="button" className={`card fin-kpi${kind === 'receivable' ? ' active' : ''}`} onClick={() => setKind('receivable')}>
          <span className="fin-kpi-label"><i className="fin-dot in" />Por cobrar</span>
          <strong className="fin-kpi-value">{usd(kpis.rec)}</strong>
          <span className="fin-kpi-sub">{kpis.recParties} {kpis.recParties === 1 ? 'cliente' : 'contrapartes'}{rate.value ? ` · ${bs(kpis.rec * rate.value)}` : ''}</span>
        </button>
        <button type="button" className={`card fin-kpi${kind === 'payable' ? ' active' : ''}`} onClick={() => setKind('payable')}>
          <span className="fin-kpi-label"><i className="fin-dot out" />Por pagar</span>
          <strong className="fin-kpi-value">{usd(kpis.pay)}</strong>
          <span className="fin-kpi-sub">{kpis.payParties} {kpis.payParties === 1 ? 'acreedor' : 'acreedores'}{rate.value ? ` · ${bs(kpis.pay * rate.value)}` : ''}</span>
        </button>
        <button type="button" className="card fin-kpi" onClick={() => setFilter('late')}>
          <span className="fin-kpi-label"><i className="fin-dot late" />Vencido</span>
          <strong className={`fin-kpi-value${(kind === 'receivable' ? kpis.recLate : kpis.payLate) > 0 ? ' late' : ''}`}>{usd(kind === 'receivable' ? kpis.recLate : kpis.payLate)}</strong>
          <span className="fin-kpi-sub">{lateLabel(kind === 'receivable' ? kpis.recLateN : kpis.payLateN, kind)}</span>
        </button>
        <div className="card fin-kpi">
          <span className="fin-kpi-label"><i className="fin-dot soon" />Próximos 7 días</span>
          <strong className="fin-kpi-value">{usd(round2(kpis.weekRec - kpis.weekPay))}</strong>
          <span className="fin-kpi-sub">entra {usd(kpis.weekRec)} · sale {usd(kpis.weekPay)}</span>
        </div>
      </div>

      <div className="fin-tabs" role="tablist">
        {Object.entries(KIND).map(([k, m]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k}
            className={`fin-tab${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
            {m.tab}{kpis.counts[k] > 0 && <span className="fin-tab-count">{kpis.counts[k]}</span>}
          </button>
        ))}
      </div>

      <div className="card fin-board">
        <div className="fin-toolbar">
          <input type="search" className="fin-search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={kind === 'receivable' ? 'Buscar cliente, venta o concepto…' : 'Buscar proveedor, gasto o concepto…'} />
          <div className="chip-row">
            {FILTERS.map(([k, label]) => (
              <button key={k} type="button" className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          <label className="fin-check">
            <input type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} />
            Mostrar saldadas
          </label>
          <span className="fin-total">Total {meta.tab.toLowerCase()}: <strong>{usd(listTotal)}</strong></span>
        </div>

        {debts === null ? (
          <div className="empty">Cargando…</div>
        ) : groups.length === 0 ? (
          <div className="fin-empty">
            <p><strong>{filter !== 'all' || search ? 'Nada coincide con el filtro.' : kind === 'receivable' ? 'Nadie te debe nada.' : 'No le debes nada a nadie.'}</strong></p>
            <p className="muted">
              {kind === 'receivable'
                ? 'Las ventas a crédito aparecen aquí solas. También puedes anotar un préstamo o un adelanto.'
                : 'Los gastos que quedan pendientes aparecen aquí solos. También puedes anotar una compra a crédito.'}
            </p>
            <button type="button" className="btn" onClick={() => setCreating({ kind })}>{meta.new}</button>
          </div>
        ) : (
          <div className="fin-groups">
            <div className="fin-row fin-head" aria-hidden="true">
              <span />
              <span>{kind === 'receivable' ? 'Quién te debe' : 'A quién le debes'}</span>
              <span className="num">Cuentas</span>
              <span className="num">Saldo</span>
              <span>Vencimiento</span>
              <span />
            </div>
            {groups.map((g) => {
              const isOpen = expanded.has(g.key);
              const info = g.balance > 0 ? dueInfo(g.next) : null;
              return (
                <div className={`fin-group${isOpen ? ' open' : ''}`} key={g.key}>
                  <div className="fin-row" onClick={() => toggle(g.key)}>
                    <span className="fin-chev" aria-hidden="true">{Chevron}</span>
                    <span className="fin-party">
                      <span className="fin-avatar" aria-hidden="true">{initials(g.name)}</span>
                      <span className="fin-party-text">
                        <strong>{g.name}</strong>
                        <span className="muted">{PARTY_LABEL[g.type]}</span>
                      </span>
                    </span>
                    <span className="num fin-count">{g.pending.length || g.debts.length}</span>
                    <span className="num fin-balance">
                      {g.balance > 0 ? usd(g.balance) : <span className="badge in">Saldada</span>}
                    </span>
                    <span>{info && <span className={`due-pill ${info.tone}`}>{info.label}</span>}</span>
                    <span className="fin-row-actions" onClick={(e) => e.stopPropagation()}>
                      {g.balance > 0 && (
                        <button type="button" className="btn primary sm"
                          onClick={() => setPaying({ name: g.name, kind, debts: g.pending })}>
                          {meta.actionAll}
                        </button>
                      )}
                    </span>
                  </div>

                  {isOpen && (
                    <div className="fin-detail">
                      <div className="fin-statement-head">
                        <span>Estado de cuenta</span>
                        <span className="muted">Total {usd(g.total)} · pendiente {usd(g.balance)}</span>
                      </div>
                      {g.debts.map((d) => {
                        const bal = balanceOf(d);
                        const di = dueInfo(d.due_date);
                        const pays = [...(d.debt_payments || [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
                        return (
                          <Fragment key={d.id}>
                            <div className={`fin-debt${bal <= 0.004 ? ' settled' : ''}`}>
                              <div className="fin-debt-main">
                                <strong>
                                  {d.order_id ? <Link to={`/orders/${d.order_id}`}>{d.concept || `Venta Nº ${d.orders?.number}`}</Link>
                                    : d.concept || <span className="muted">Sin concepto</span>}
                                </strong>
                                <span className="muted">
                                  Emitida {formatDate(d.issue_date)}
                                  {d.expense_id && ' · desde Gastos'}
                                  {d.note && ` · ${d.note}`}
                                </span>
                              </div>
                              <div className="fin-debt-amounts">
                                <span>{usd(d.amount_usd)}</span>
                                {Number(d.paid_usd) > 0 && <span className="muted">abonado {usd(d.paid_usd)}</span>}
                              </div>
                              <div className="fin-debt-due">
                                {bal > 0.004 ? <span className={`due-pill ${di.tone}`}>{di.label}</span> : <span className="badge in">Saldada</span>}
                                {bal > 0.004 && Number(d.paid_usd) > 0 && <span className="muted">resta {usd(bal)}</span>}
                              </div>
                              <div className="fin-debt-actions">
                                {bal > 0.004 && (
                                  <button type="button" className="btn sm" onClick={() => setPaying({ name: g.name, kind, debts: [d] })}>
                                    {meta.action}
                                  </button>
                                )}
                                <button type="button" className="btn ghost sm" onClick={() => setEditing(d)}>Editar</button>
                                {!d.order_id && !d.expense_id && pays.length === 0 && (
                                  <button type="button" className="btn ghost sm danger-text" onClick={() => onDelete(d)}>Borrar</button>
                                )}
                              </div>
                            </div>
                            {pays.map((p) => (
                              <div className="fin-payment" key={p.id}>
                                <span className="fin-payment-dot" aria-hidden="true" />
                                <span>
                                  {meta.verb} el {formatDate(p.created_at)} por {p.account_name}
                                  {p.note && <span className="muted"> · {p.note}</span>}
                                </span>
                                <span className="fin-payment-amount">
                                  {p.currency === 'USD' ? usd(p.amount) : `${bs(p.amount)} (${usd(p.amount_usd)})`}
                                </span>
                                <button type="button" className="btn ghost sm" onClick={() => onDeletePayment(p, d)}>Deshacer</button>
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
        <DebtForm initial={creating} customers={customers} suppliers={suppliers} branchId={branchId}
          onClose={() => setCreating(null)}
          onSaved={async (d) => { setCreating(null); setKind(d.kind); await load(); }} />
      )}
      {editing && (
        <DebtEdit debt={editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }} />
      )}
      {paying && (
        <PayModal target={paying} accounts={accounts} rate={rate}
          onClose={() => setPaying(null)}
          onPaid={async () => { setPaying(null); await load(); notifyCashChanged(); }} />
      )}
    </div>
  );
}

// ---------- Nueva cuenta ----------
function DebtForm({ initial, customers, suppliers, branchId, onClose, onSaved }) {
  const [f, setF] = useState({
    kind: initial.kind, partyType: initial.kind === 'receivable' ? 'customer' : 'supplier',
    partyId: '', partyName: '', concept: '', amount: '',
    issueDate: localISO(), dueDate: addDays(localISO(), 15), note: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const parties = f.partyType === 'customer' ? customers : f.partyType === 'supplier' ? suppliers : [];

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const d = await createDebt({
        kind: f.kind, partyType: f.partyType,
        customerId: f.partyType === 'customer' ? f.partyId : null,
        supplierId: f.partyType === 'supplier' ? f.partyId : null,
        partyName: f.partyName, concept: f.concept, amountUsd: num(f.amount),
        issueDate: f.issueDate, dueDate: f.dueDate || null, note: f.note, branchId,
      });
      await onSaved(d);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal card fin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Nueva cuenta</h2>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={onClose}>Cerrar</button>
        </div>
        <form onSubmit={onSubmit} className="vform">
          <div className="fin-choice">
            {Object.entries(KIND).map(([k, m]) => (
              <label key={k} className={`fin-choice-opt${f.kind === k ? ' on' : ''}`}>
                <input type="radio" name="kind" checked={f.kind === k}
                  onChange={() => setF((x) => ({ ...x, kind: k, partyType: k === 'receivable' ? 'customer' : 'supplier', partyId: '' }))} />
                <strong>{m.tab}</strong>
                <span className="muted">{k === 'receivable' ? 'Alguien te debe' : 'Tú le debes a alguien'}</span>
              </label>
            ))}
          </div>

          <div className="fin-grid">
            <label>Es
              <select value={f.partyType} onChange={(e) => setF((x) => ({ ...x, partyType: e.target.value, partyId: '' }))}>
                <option value="customer">Un cliente</option>
                <option value="supplier">Un proveedor</option>
                <option value="other">Otro (empleado, socio…)</option>
              </select>
            </label>
            {f.partyType === 'other' ? (
              <label>Nombre
                <input required value={f.partyName} onChange={set('partyName')} placeholder="María Pérez" />
              </label>
            ) : (
              <label>{f.partyType === 'customer' ? 'Cliente' : 'Proveedor'}
                <select required value={f.partyId} onChange={set('partyId')}>
                  <option value="">Elige…</option>
                  {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
          </div>
          {f.partyType !== 'other' && parties.length === 0 && (
            <p className="hint">
              No hay {f.partyType === 'customer' ? 'clientes' : 'proveedores'} registrados.
              Agrégalos en <Link to={f.partyType === 'customer' ? '/customers' : '/suppliers'} onClick={onClose}>
                {f.partyType === 'customer' ? 'Clientes' : 'Proveedores'}</Link> o elige “Otro”.
            </p>
          )}

          <label>Concepto
            <input value={f.concept} onChange={set('concept')}
              placeholder={f.kind === 'receivable' ? 'Préstamo, adelanto, venta anterior…' : 'Compra de mercancía, factura 0012…'} />
          </label>
          <div className="fin-grid">
            <label>Monto en dólares
              <input required inputMode="decimal" placeholder="0,00" value={f.amount} onChange={set('amount')} />
            </label>
            <label>Fecha
              <input type="date" value={f.issueDate} onChange={set('issueDate')} />
            </label>
          </div>
          <label>Vence
            <div className="fin-due-row">
              <input type="date" value={f.dueDate} onChange={set('dueDate')} />
              <div className="chip-row">
                {[[7, '7 días'], [15, '15 días'], [30, '30 días']].map(([n, l]) => (
                  <button type="button" key={n} className={`chip${f.dueDate === addDays(f.issueDate, n) ? ' on' : ''}`}
                    onClick={() => setF((x) => ({ ...x, dueDate: addDays(x.issueDate, n) }))}>{l}</button>
                ))}
                <button type="button" className={`chip${!f.dueDate ? ' on' : ''}`} onClick={() => setF((x) => ({ ...x, dueDate: '' }))}>Sin fecha</button>
              </div>
            </div>
          </label>
          <label>Nota (opcional)
            <input value={f.note} onChange={set('note')} />
          </label>
          {error && <div className="form-error">{error}</div>}
          <div className="inline-form-actions">
            <button className="btn primary" disabled={busy || !num(f.amount)}>{busy ? 'Guardando…' : 'Guardar cuenta'}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
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
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal card fin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{debt.party_name}</h2>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={onClose}>Cerrar</button>
        </div>
        <form onSubmit={onSubmit} className="vform">
          <label>Concepto <input value={f.concept} onChange={set('concept')} /></label>
          <div className="fin-grid">
            <label>Monto en dólares
              <input inputMode="decimal" value={f.amount} onChange={set('amount')} disabled={locked} />
            </label>
            <label>Vence
              <input type="date" value={f.dueDate} onChange={set('dueDate')} />
            </label>
          </div>
          {locked && <p className="hint">El monto viene de {debt.order_id ? 'la venta' : 'el gasto'}; no se cambia aquí.</p>}
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

// ---------- Cobrar / pagar ----------
// Se puede abonar una parte: el monto se reparte de la cuenta que vence primero
// a la última. Va en la moneda de la cuenta elegida.
function PayModal({ target, accounts, rate, onClose, onPaid }) {
  const meta = KIND[target.kind];
  const balance = round2(target.debts.reduce((s, d) => s + balanceOf(d), 0));
  const [accountId, setAccountId] = useState(() => accounts[0]?.id || '');
  const account = accounts.find((a) => a.id === accountId);
  const ves = account?.currency === 'VES';
  const full = ves ? round2(balance * (rate.value || 0)) : balance;
  const [amount, setAmount] = useState(() => String(full.toFixed(2)));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Al cambiar de moneda se reescribe el monto completo en la nueva moneda.
  useEffect(() => { setAmount(full ? full.toFixed(2) : ''); }, [ves]); // eslint-disable-line react-hooks/exhaustive-deps

  const amt = num(amount);
  const amtUsd = ves ? (rate.value ? round2(amt / rate.value) : 0) : amt;
  const rest = round2(balance - amtUsd);
  const over = amtUsd - balance > 0.01;

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await payDebts(target.debts.map((d) => d.id), accountId, amt, rate.value, note);
      await onPaid();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal card fin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{meta.verb} {target.kind === 'receivable' ? 'de' : 'a'} {target.name}</h2>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={onClose}>Cerrar</button>
        </div>
        <div className="fin-pay-summary">
          <span className="muted">{target.debts.length === 1 ? (target.debts[0].concept || 'Saldo pendiente') : `${target.debts.length} cuentas pendientes`}</span>
          <strong>{usd(balance)}</strong>
          {rate.value > 0 && <span className="muted">{bs(balance * rate.value)} a {bs(rate.value)}</span>}
        </div>
        <form onSubmit={onSubmit} className="vform">
          <label>{target.kind === 'receivable' ? 'Entra por' : 'Sale de'}
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              {accounts.length === 0 && <option value="">No hay cuentas: créalas en Negocio → Cuentas</option>}
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency === 'USD' ? '$' : 'Bs'}){a.is_cash ? ' · efectivo' : ''}</option>)}
            </select>
          </label>
          <label>Monto {ves ? 'en bolívares' : 'en dólares'}
            <div className="fin-amount-row">
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              <button type="button" className="chip" onClick={() => setAmount(full.toFixed(2))}>Todo</button>
            </div>
          </label>
          <p className={`hint fin-pay-hint${over ? ' bad' : ''}`}>
            {over ? `Supera el saldo por ${usd(amtUsd - balance)}.`
              : rest > 0.004 ? `Abono parcial: ${ves ? `${usd(amtUsd)} · ` : ''}queda pendiente ${usd(rest)}.`
                : `Salda la cuenta${ves ? ` (${usd(amtUsd)})` : ''}.`}
            {account?.is_cash && ` ${target.kind === 'receivable' ? 'Entra' : 'Sale'} de la caja si está abierta.`}
          </p>
          <label>Comentario (opcional)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Referencia, número de transferencia…" />
          </label>
          {error && <div className="form-error">{error}</div>}
          <div className="inline-form-actions">
            <button className="btn primary" disabled={busy || !accountId || amt <= 0 || over || (ves && !rate.value)}>
              {busy ? 'Guardando…' : `Confirmar ${meta.verb.toLowerCase()}`}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
