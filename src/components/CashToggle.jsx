import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { useConfirm } from './Confirm';
import OpenCashModal from './OpenCashModal';
import {
  fetchOpenCashSession, fetchCashSessions, fetchCashReport, fetchBankAccounts,
  closeCashSession, addCashMovement, deleteCashMovement, countOrphanOrders, fetchStaff,
} from '../lib/api';
import { fetchBcvRates, resolveRate } from '../lib/rates';
import { usd, bs, formatDate } from '../lib/calc';
import { CASH_EVENT, notifyCashChanged } from '../lib/cashEvents';


const amount = (n, currency) => (currency === 'USD' ? usd(n) : bs(n));
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(',', '.')));
const hour = (iso) => new Date(iso).toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit' });
const sameDay = (iso) => new Date(iso).toDateString() === new Date().toDateString();


// Interruptor de caja en la parte de arriba del menú lateral. Apagado: abre la
// caja con el fondo del día. Encendido: abre el arqueo para cerrarla. La caja
// es por sucursal (la que está elegida en el menú).
export default function CashToggle({ onAction }) {
  const { business } = useAuth();
  const { branchId } = useBranch();
  const [session, setSession] = useState(undefined);   // undefined = cargando, null = cerrada
  const [opening, setOpening] = useState(false);
  const [panel, setPanel] = useState(null);           // la sesión que muestra el panel

  const load = useCallback(async () => {
    try { setSession(await fetchOpenCashSession(branchId)); }
    catch { setSession(null); }
  }, [branchId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener(CASH_EVENT, load);
    return () => window.removeEventListener(CASH_EVENT, load);
  }, [load]);

  // Con el panel abierto, los movimientos nuevos del turno se reflejan en él.
  useEffect(() => {
    setPanel((p) => (p && session && p.id === session.id ? session : p));
  }, [session]);

  const open = !!session;
  const since = session ? (sameDay(session.opened_at) ? hour(session.opened_at) : formatDate(session.opened_at)) : '';

  function onClick() {
    if (session === undefined) return;
    onAction?.();
    if (open) setPanel(session); else setOpening(true);
  }

  return (
    <>
      <button type="button" className={`cash-toggle${open ? ' on' : ''}`} onClick={onClick}
        role="switch" aria-checked={open} disabled={session === undefined}
        title={open ? `Caja abierta desde ${since}. Toca para cerrarla.` : 'Caja cerrada. Toca para abrirla.'}>
        <span className="cash-toggle-text">
          <span className="cash-toggle-label">{open ? 'Caja abierta' : 'Caja cerrada'}</span>
          <span className="cash-toggle-sub">{session === undefined ? '…' : open ? `Desde ${since}` : 'Toca para abrir'}</span>
        </span>
        <span className={`switch sm${open ? ' on' : ''}`} aria-hidden="true"><span className="switch-knob" /></span>
      </button>

      {opening && (
        <OpenCashModal branchId={branchId} onClose={() => setOpening(false)}
          onOpened={async () => { setOpening(false); await load(); notifyCashChanged(); }} />
      )}
      {panel && (
        <CashPanel session={panel} business={business} branchId={branchId}
          onClose={() => setPanel(null)}
          onChanged={async () => { await load(); notifyCashChanged(); }} />
      )}
    </>
  );
}

// Caja abierta: lo que debería haber, los movimientos del turno y el arqueo
// para cerrarla. Desde aquí también se ven los cierres anteriores.
function CashPanel({ session, business, branchId, onClose, onChanged }) {
  const ask = useConfirm();
  const [view, setView] = useState('close');           // 'close' | 'move' | 'history'
  const [report, setReport] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [history, setHistory] = useState(null);
  const [detail, setDetail] = useState(null);
  const [rate, setRate] = useState({ value: 0 });
  const [orphans, setOrphans] = useState(0);
  const [counted, setCounted] = useState({});
  const [note, setNote] = useState('');
  const [move, setMove] = useState({ direction: 'out', accountId: '', amount: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [justClosed, setJustClosed] = useState(false);

  const loadReport = useCallback(async () => {
    try {
      setReport(await fetchCashReport(session.id));
      setOrphans(await countOrphanOrders(branchId, session.opened_at));
    } catch (e) { setError(e.message); }
  }, [session.id, session.opened_at, branchId]);

  useEffect(() => { loadReport(); }, [loadReport]);
  useEffect(() => {
    fetchBankAccounts().then((a) => {
      const act = a.filter((x) => x.active);
      setAccounts(act);
      setMove((m) => ({ ...m, accountId: m.accountId || act.find((x) => x.is_cash)?.id || act[0]?.id || '' }));
    }).catch(() => {});
    fetchStaff().then(setStaff).catch(() => {});
    fetchBcvRates().then((r) => setRate(resolveRate(business?.rate_config, r))).catch(() => {});
  }, [business]);
  useEffect(() => {
    if (view === 'history' && history === null) fetchCashSessions(branchId).then(setHistory).catch((e) => setError(e.message));
  }, [view, history, branchId]);

  const who = useMemo(() => {
    const m = new Map(staff.map((s) => [s.id, s.full_name || s.username || s.email]));
    return (id) => m.get(id) || '—';
  }, [staff]);

  const cashRows = (report || []).filter((r) => r.is_cash);
  const otherRows = (report || []).filter((r) => !r.is_cash && Number(r.sales) > 0);
  const movements = [...(session.cash_movements || [])].sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function onCloseCash(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const closed = await closeCashSession(session.id,
        cashRows.filter((r) => num(counted[r.account_id]) !== null)
          .map((r) => ({ account_id: r.account_id, amount: num(counted[r.account_id]) })),
        rate.value, note);
      const h = await fetchCashSessions(branchId);
      setHistory(h);
      setDetail(h.find((x) => x.id === closed.id) || null);
      setView('history');
      setJustClosed(true);
      await onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function onMove(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await addCashMovement(session.id, move.accountId, move.direction, num(move.amount), move.reason);
      setMove((m) => ({ ...m, amount: '', reason: '' }));
      setView('close');
      await onChanged(); await loadReport();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function onDeleteMove(m) {
    if (!await ask({
      title: `¿Borrar este ${m.direction === 'out' ? 'retiro' : 'aporte'}?`,
      message: `${amount(m.amount, m.currency)} de ${m.account_name}${m.reason ? ` · ${m.reason}` : ''}.`,
      confirmLabel: 'Borrar',
    })) return;
    try { await deleteCashMovement(m.id); await onChanged(); await loadReport(); }
    catch (err) { setError(err.message); }
  }

  const closedNow = justClosed && view === 'history' && detail?.id === session.id;

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal card modal-wide cash-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{closedNow ? 'Caja cerrada' : view === 'history' ? 'Cierres anteriores' : view === 'move' ? 'Retiro o aporte' : 'Cerrar caja'}</h2>
            {view === 'close' && (
              <p className="muted cash-panel-sub">
                Abierta {sameDay(session.opened_at) ? `hoy a las ${hour(session.opened_at)}` : `el ${formatDate(session.opened_at)}`} por {who(session.opened_by)}
                {session.open_note ? ` · ${session.open_note}` : ''}
              </p>
            )}
          </div>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={onClose}>Cerrar</button>
        </div>

        {view !== 'history' && (
          <div className="seg sm cash-panel-tabs">
            <button type="button" className={`seg-btn${view === 'close' ? ' active' : ''}`} onClick={() => setView('close')}>Arqueo</button>
            <button type="button" className={`seg-btn${view === 'move' ? ' active' : ''}`} onClick={() => setView('move')}>Retiro o aporte</button>
            <button type="button" className="seg-btn" onClick={() => { setDetail(null); setView('history'); }}>Historial</button>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        {view === 'close' && (
          report === null ? <div className="empty">Cargando…</div> : (
            <form onSubmit={onCloseCash} className="vform">
              {orphans > 0 && (
                <div className="form-error">
                  Hay {orphans} {orphans === 1 ? 'venta hecha' : 'ventas hechas'} con la caja cerrada;
                  no {orphans === 1 ? 'entra' : 'entran'} en este arqueo.
                </div>
              )}
              <p className="hint">
                Cuenta el efectivo y escribe cuánto hay de verdad. El cierre guarda las dos cifras y su diferencia.
              </p>
              {cashRows.length === 0 ? (
                <p className="hint">
                  Ninguna cuenta está marcada como efectivo. Márcalas en <Link to="/settings" onClick={onClose}>Negocio → Cuentas</Link>.
                </p>
              ) : cashRows.map((r) => {
                const c = num(counted[r.account_id]);
                const dif = c === null ? null : Math.round((c - Number(r.expected)) * 100) / 100;
                return (
                  <div className="arqueo-row" key={r.account_id}>
                    <div className="arqueo-name">
                      <strong>{r.account_name}</strong>
                      <span className="muted">Debería haber {amount(r.expected, r.currency)}</span>
                      <span className="muted cash-cell-detail">
                        fondo {amount(r.opening, r.currency)} + ventas {amount(r.sales, r.currency)}
                        {Number(r.moves_in) > 0 && ` + entradas ${amount(r.moves_in, r.currency)}`}
                        {Number(r.moves_out) > 0 && ` − salidas ${amount(r.moves_out, r.currency)}`}
                      </span>
                    </div>
                    <input inputMode="decimal" placeholder="Contado" value={counted[r.account_id] ?? ''}
                      onChange={(e) => setCounted((x) => ({ ...x, [r.account_id]: e.target.value }))} />
                    <span className={`arqueo-dif${dif === null ? '' : dif === 0 ? ' ok' : ' bad'}`}>
                      {dif === null ? '—' : dif === 0 ? 'Cuadra' : `${dif > 0 ? 'Sobra' : 'Falta'} ${amount(Math.abs(dif), r.currency)}`}
                    </span>
                  </div>
                );
              })}

              {otherRows.length > 0 && (
                <div className="totals">
                  <div className="totals-row"><span className="muted">Cobrado por otros medios (no se cuenta)</span><span /></div>
                  {otherRows.map((r) => (
                    <div className="totals-row" key={r.account_id}>
                      <span>{r.account_name}</span><span>{amount(r.sales, r.currency)}</span>
                    </div>
                  ))}
                </div>
              )}

              {movements.length > 0 && (
                <details className="vmore">
                  <summary>Entradas y salidas del turno ({movements.length})</summary>
                  <div className="totals">
                    {movements.map((m) => (
                      <div className="totals-row cash-move" key={m.id}>
                        <span>
                          <span className={`badge ${m.direction === 'out' ? 'out' : 'in'}`}>{m.direction === 'out' ? 'Salida' : 'Entrada'}</span>
                          {' '}{m.reason || <span className="muted">Sin motivo</span>}
                          <span className="muted"> · {m.account_name}</span>
                        </span>
                        <span className="cash-move-right">
                          {m.direction === 'out' ? '−' : '+'}{amount(m.amount, m.currency)}
                          <button type="button" className="btn ghost sm" onClick={() => onDeleteMove(m)}>Borrar</button>
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <label>Nota del cierre (opcional)
                <input value={note} placeholder="Faltó porque se dio vuelto de más…" onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="inline-form-actions">
                <button className="btn primary" disabled={busy}>{busy ? 'Cerrando…' : 'Cerrar caja'}</button>
                <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Dejarla abierta</button>
              </div>
            </form>
          )
        )}

        {view === 'move' && (
          <form onSubmit={onMove} className="vform">
            <p className="hint">
              Plata que entra o sale de la caja sin ser una venta: lo que sacó el dueño, sencillo para el vuelto.
              Los gastos regístralos en <Link to="/expenses" onClick={onClose}>Gastos</Link>: si se pagan en efectivo, salen solos de la caja.
            </p>
            <div className="seg sm">
              <button type="button" className={`seg-btn${move.direction === 'out' ? ' active' : ''}`}
                onClick={() => setMove((m) => ({ ...m, direction: 'out' }))}>Retiro</button>
              <button type="button" className={`seg-btn${move.direction === 'in' ? ' active' : ''}`}
                onClick={() => setMove((m) => ({ ...m, direction: 'in' }))}>Aporte</button>
            </div>
            <label>Cuenta
              <select value={move.accountId} onChange={(e) => setMove((m) => ({ ...m, accountId: e.target.value }))}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency === 'USD' ? '$' : 'Bs'})</option>)}
              </select>
            </label>
            <label>Monto
              <input inputMode="decimal" required placeholder="0" value={move.amount}
                onChange={(e) => setMove((m) => ({ ...m, amount: e.target.value }))} />
            </label>
            <label>Motivo
              <input value={move.reason} placeholder={move.direction === 'out' ? 'Retiro del dueño…' : 'Sencillo para el vuelto…'}
                onChange={(e) => setMove((m) => ({ ...m, reason: e.target.value }))} />
            </label>
            <div className="inline-form-actions">
              <button className="btn primary" disabled={busy || !move.amount || !move.accountId}>{busy ? 'Guardando…' : 'Guardar'}</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setView('close')}>Volver</button>
            </div>
          </form>
        )}

        {view === 'history' && (
          detail ? (
            <CashClosing detail={detail} who={who} onBack={closedNow ? null : () => setDetail(null)} />
          ) : history === null ? <div className="empty">Cargando…</div> : (
            <>
              {history.length === 0 ? <p className="hint">Todavía no hay cierres.</p> : (
                <div className="totals">
                  {history.map((h) => {
                    const lines = (h.cash_session_lines || []).filter((l) => l.counted !== null);
                    const cuadro = lines.every((l) => Number(l.counted) === Number(l.expected));
                    return (
                      <button type="button" className="totals-row cash-hist" key={h.id} onClick={() => setDetail(h)}>
                        <span>{formatDate(h.closed_at)}<span className="muted"> · cerró {who(h.closed_by)}</span></span>
                        <span>
                          {lines.length === 0 ? <span className="muted">sin contar</span>
                            : cuadro ? <span className="badge in">Cuadró</span> : <span className="badge out">Con diferencia</span>}
                          <span className="mcard-chev" aria-hidden="true"> ›</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="inline-form-actions">
                <button type="button" className="btn ghost" onClick={() => setView('close')}>Volver al arqueo</button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}

function CashClosing({ detail, who, onBack }) {
  return (
    <>
      <p className="hint">
        Cierre del {formatDate(detail.closed_at)}. Abrió {who(detail.opened_by)} el {formatDate(detail.opened_at)} y cerró {who(detail.closed_by)}.
        {detail.close_note ? ` ${detail.close_note}` : ''}
      </p>
      <div className="totals">
        {[...(detail.cash_session_lines || [])]
          .sort((a, b) => Number(b.is_cash) - Number(a.is_cash) || a.sort_order - b.sort_order)
          .filter((l) => l.is_cash || Number(l.sales) > 0)
          .map((l) => {
            const dif = l.counted === null ? null : Math.round((Number(l.counted) - Number(l.expected)) * 100) / 100;
            return (
              <div className="totals-row" key={l.id}>
                <span>
                  {l.account_name}
                  {l.is_cash
                    ? <span className="muted"> · fondo {amount(l.opening, l.currency)} · ventas {amount(l.sales, l.currency)}
                      {Number(l.moves_in) > 0 && ` · entradas ${amount(l.moves_in, l.currency)}`}
                      {Number(l.moves_out) > 0 && ` · salidas ${amount(l.moves_out, l.currency)}`}</span>
                    : <span className="muted"> · cobrado por este medio</span>}
                </span>
                <span>
                  {l.is_cash ? (
                    <>
                      {amount(l.counted ?? 0, l.currency)}
                      <span className="muted"> de {amount(l.expected, l.currency)}</span>
                      {dif !== null && dif !== 0 && (
                        <span className="arqueo-dif bad"> {dif > 0 ? 'sobró' : 'faltó'} {amount(Math.abs(dif), l.currency)}</span>
                      )}
                    </>
                  ) : amount(l.sales, l.currency)}
                </span>
              </div>
            );
          })}
      </div>
      {Number(detail.rate) > 0 && <p className="hint">Tasa al cerrar: {bs(detail.rate)} por dólar.</p>}
      {onBack && (
        <div className="inline-form-actions">
          <button type="button" className="btn ghost" onClick={onBack}>Ver todos los cierres</button>
        </div>
      )}
    </>
  );
}
