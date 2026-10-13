import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { useConfirm } from '../components/Confirm';
import {
  fetchOpenCashSession, fetchCashSessions, fetchCashReport, fetchBankAccounts,
  openCashSession, closeCashSession, addCashMovement, deleteCashMovement,
  countOrphanOrders, fetchStaff,
} from '../lib/api';
import { fetchBcvRates, resolveRate } from '../lib/rates';
import { usd, bs, formatDate } from '../lib/calc';

// Cada cuenta lleva su propia moneda, así que el monto se muestra con el
// formato que le toca y nunca se suman bolívares con dólares.
const amount = (n, currency) => (currency === 'USD' ? usd(n) : bs(n));
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(',', '.')));

export default function Cash() {
  const { business } = useAuth();
  const { branchId, currentBranch, branches } = useBranch();
  const ask = useConfirm();

  const [session, setSession] = useState(undefined);   // undefined = cargando, null = cerrada
  const [report, setReport] = useState([]);
  const [history, setHistory] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [rate, setRate] = useState({ value: 0 });
  const [orphans, setOrphans] = useState(0);
  const [error, setError] = useState(null);

  const [opening, setOpening] = useState(null);        // { amounts:{id:val}, note, busy, error }
  const [move, setMove] = useState(null);              // { direction, accountId, amount, reason, busy, error }
  const [closing, setClosing] = useState(null);        // { counted:{id:val}, note, busy, error }
  const [detail, setDetail] = useState(null);          // cierre del historial que se está viendo

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await fetchOpenCashSession(branchId);
      setSession(s);
      setReport(s ? await fetchCashReport(s.id) : []);
      setHistory(await fetchCashSessions(branchId));
      // Ventas que se hicieron sin caja abierta: no entran en ningún arqueo.
      setOrphans(await countOrphanOrders(branchId, s?.opened_at));
    } catch (e) { setError(e.message); setSession(null); }
  }, [branchId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchBankAccounts().then((a) => setAccounts(a.filter((x) => x.active))).catch(() => {});
    fetchStaff().then(setStaff).catch(() => {});
    fetchBcvRates().then((r) => setRate(resolveRate(business?.rate_config, r))).catch(() => {});
  }, [business]);

  const staffName = useMemo(() => {
    const m = new Map();
    staff.forEach((s) => m.set(s.id, s.full_name || s.username || s.email));
    return m;
  }, [staff]);
  const who = (id) => staffName.get(id) || '—';

  const cashAccounts = accounts.filter((a) => a.is_cash);
  const cashRows = report.filter((r) => r.is_cash);
  const otherRows = report.filter((r) => !r.is_cash);
  const movements = useMemo(
    () => [...(session?.cash_movements || [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [session],
  );

  // ---------- acciones ----------
  async function onOpen(e) {
    e.preventDefault();
    setOpening((o) => ({ ...o, busy: true, error: null }));
    try {
      await openCashSession(branchId,
        cashAccounts.map((a) => ({ account_id: a.id, amount: num(opening.amounts[a.id]) || 0 })),
        opening.note);
      setOpening(null);
      await load();
    } catch (err) { setOpening((o) => ({ ...o, busy: false, error: err.message })); }
  }

  async function onMove(e) {
    e.preventDefault();
    setMove((m) => ({ ...m, busy: true, error: null }));
    try {
      await addCashMovement(session.id, move.accountId, move.direction, num(move.amount), move.reason);
      setMove(null);
      await load();
    } catch (err) { setMove((m) => ({ ...m, busy: false, error: err.message })); }
  }

  async function onDeleteMove(m) {
    const signo = m.direction === 'out' ? 'retiro' : 'aporte';
    if (!await ask({
      title: `¿Borrar este ${signo}?`,
      message: `${amount(m.amount, m.currency)} de ${m.account_name}${m.reason ? ` · ${m.reason}` : ''}. La caja vuelve a contar ese dinero.`,
      confirmLabel: 'Borrar',
    })) return;
    try { await deleteCashMovement(m.id); await load(); }
    catch (err) { setError(err.message); }
  }

  async function onClose(e) {
    e.preventDefault();
    setClosing((c) => ({ ...c, busy: true, error: null }));
    try {
      const closed = await closeCashSession(session.id,
        cashRows.filter((r) => num(closing.counted[r.account_id]) !== null)
          .map((r) => ({ account_id: r.account_id, amount: num(closing.counted[r.account_id]) })),
        rate.value, closing.note);
      setClosing(null);
      await load();
      setDetail(await fetchCashSessions(branchId).then((h) => h.find((x) => x.id === closed.id)));
    } catch (err) { setClosing((c) => ({ ...c, busy: false, error: err.message })); }
  }

  // ---------- render ----------
  const sucursal = branches.length > 1 && currentBranch ? ` · ${currentBranch.name}` : '';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Caja{sucursal}</h1>
          <p className="page-sub">
            Abre la caja con el fondo del día, anota los retiros y ciérrala contando lo que hay.
          </p>
        </div>
        <div className="page-actions">
          {session === null && (
            <button type="button" className="btn primary"
              onClick={() => setOpening({ amounts: {}, note: '' })}>Abrir caja</button>
          )}
          {session && (
            <button type="button" className="btn primary"
              onClick={() => setClosing({ counted: {}, note: '' })}>Cerrar caja</button>
          )}
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      {session === undefined ? (
        <div className="empty">Cargando…</div>
      ) : session === null ? (
        <div className="card cash-closed">
          <h2>La caja está cerrada</h2>
          <p className="hint">
            Mientras esté cerrada se puede seguir vendiendo, pero esas ventas no entran en
            ningún arqueo. Ábrela al empezar el día declarando cuánto efectivo tienes.
          </p>
          <button type="button" className="btn primary"
            onClick={() => setOpening({ amounts: {}, note: '' })}>Abrir caja</button>
        </div>
      ) : (
        <>
          <div className="cash-bar card">
            <div>
              <span className="badge in">Caja abierta</span>
              <strong className="cash-since">Desde {formatDate(session.opened_at)}</strong>
              <span className="muted"> · abrió {who(session.opened_by)}</span>
              {session.open_note && <span className="muted"> · {session.open_note}</span>}
            </div>
            <button type="button" className="btn ghost sm"
              onClick={() => setMove({ direction: 'out', accountId: cashAccounts[0]?.id || '', amount: '', reason: '' })}>
              Retiro o gasto
            </button>
          </div>

          {orphans > 0 && (
            <div className="form-error">
              Hay {orphans} {orphans === 1 ? 'venta hecha' : 'ventas hechas'} con la caja cerrada;
              no {orphans === 1 ? 'entra' : 'entran'} en este arqueo.
            </div>
          )}

          <section className="card vsection">
            <h2>Efectivo en caja</h2>
            {cashRows.length === 0 ? (
              <p className="hint">
                Ninguna cuenta está marcada como efectivo. Márcalas en{' '}
                <Link to="/settings">Negocio → Cuentas</Link> para poder contarlas.
              </p>
            ) : (
              <div className="cash-grid">
                {cashRows.map((r) => (
                  <div className="cash-cell" key={r.account_id}>
                    <span className="cash-cell-name">{r.account_name}</span>
                    <strong className="cash-cell-amount">{amount(r.expected, r.currency)}</strong>
                    <span className="muted cash-cell-detail">
                      fondo {amount(r.opening, r.currency)} + ventas {amount(r.sales, r.currency)}
                      {Number(r.moves_in) > 0 && ` + aportes ${amount(r.moves_in, r.currency)}`}
                      {Number(r.moves_out) > 0 && ` − retiros ${amount(r.moves_out, r.currency)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {otherRows.length > 0 && (
            <section className="card vsection">
              <h2>Cobrado por otros medios</h2>
              <p className="hint">No se cuenta en el arqueo; queda como referencia de lo que entró hoy.</p>
              <div className="totals">
                {otherRows.map((r) => (
                  <div className="totals-row" key={r.account_id}>
                    <span>{r.account_name}</span>
                    <span>{amount(r.sales, r.currency)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card vsection">
            <h2>Retiros y aportes</h2>
            {movements.length === 0 ? (
              <p className="hint">
                Nada por ahora. Anota aquí la plata que sale o entra de la caja sin ser una venta:
                lo que se le pagó al delivery, un gasto, el sencillo que metiste.
              </p>
            ) : (
              <div className="totals">
                {movements.map((m) => (
                  <div className="totals-row cash-move" key={m.id}>
                    <span>
                      <span className={`badge ${m.direction === 'out' ? 'out' : 'in'}`}>
                        {m.direction === 'out' ? 'Retiro' : 'Aporte'}
                      </span>
                      {' '}{m.reason || <span className="muted">Sin motivo</span>}
                      <span className="muted"> · {m.account_name} · {who(m.created_by)}</span>
                    </span>
                    <span className="cash-move-right">
                      {m.direction === 'out' ? '−' : '+'}{amount(m.amount, m.currency)}
                      <button type="button" className="btn ghost sm" onClick={() => onDeleteMove(m)}>Borrar</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="inline-form-actions">
              <button type="button" className="btn sm"
                onClick={() => setMove({ direction: 'out', accountId: cashAccounts[0]?.id || '', amount: '', reason: '' })}>
                Registrar retiro o gasto
              </button>
              <button type="button" className="btn ghost sm"
                onClick={() => setMove({ direction: 'in', accountId: cashAccounts[0]?.id || '', amount: '', reason: '' })}>
                Registrar aporte
              </button>
            </div>
          </section>
        </>
      )}

      {history.length > 0 && (
        <section className="card vsection">
          <h2>Cierres anteriores</h2>
          <div className="totals">
            {history.map((h) => {
              const dif = (h.cash_session_lines || []).filter((l) => l.counted !== null);
              const cuadro = dif.every((l) => Number(l.counted) === Number(l.expected));
              return (
                <button type="button" className="totals-row cash-hist" key={h.id} onClick={() => setDetail(h)}>
                  <span>
                    {formatDate(h.closed_at)}
                    <span className="muted"> · cerró {who(h.closed_by)}</span>
                  </span>
                  <span>
                    {dif.length === 0 ? <span className="muted">sin contar</span>
                      : cuadro ? <span className="badge in">Cuadró</span>
                        : <span className="badge out">Con diferencia</span>}
                    <span className="mcard-chev" aria-hidden="true"> ›</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* -------- Abrir caja -------- */}
      {opening && (
        <div className="modal-backdrop" onClick={() => !opening.busy && setOpening(null)}>
          <div className="modal card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Abrir caja</h2>
              <button type="button" className="btn ghost sm" disabled={opening.busy}
                onClick={() => setOpening(null)}>Cerrar</button>
            </div>
            <p className="hint">
              Cuenta lo que hay ahora mismo en la caja: es el fondo con el que arranca el día.
              Déjalo en cero si empiezas sin efectivo.
            </p>
            <form onSubmit={onOpen} className="vform">
              {cashAccounts.length === 0 ? (
                <p className="hint">
                  Ninguna cuenta está marcada como efectivo; la caja se abre sin fondo.
                  Puedes marcarlas en <Link to="/settings">Negocio → Cuentas</Link>.
                </p>
              ) : cashAccounts.map((a) => (
                <label key={a.id}>
                  <span>{a.name} <span className="muted">en {a.currency === 'USD' ? 'dólares' : 'bolívares'}</span></span>
                  <input inputMode="decimal" placeholder="0" value={opening.amounts[a.id] ?? ''}
                    onChange={(e) => setOpening((o) => ({ ...o, amounts: { ...o.amounts, [a.id]: e.target.value } }))} />
                </label>
              ))}
              <label>Nota (opcional)
                <input value={opening.note} placeholder="Turno de la mañana…"
                  onChange={(e) => setOpening((o) => ({ ...o, note: e.target.value }))} />
              </label>
              {opening.error && <div className="form-error">{opening.error}</div>}
              <div className="inline-form-actions">
                <button className="btn primary" disabled={opening.busy}>
                  {opening.busy ? 'Abriendo…' : 'Abrir caja'}
                </button>
                <button type="button" className="btn ghost" disabled={opening.busy}
                  onClick={() => setOpening(null)}>Volver</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -------- Retiro / aporte -------- */}
      {move && (
        <div className="modal-backdrop" onClick={() => !move.busy && setMove(null)}>
          <div className="modal card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{move.direction === 'out' ? 'Retiro o gasto' : 'Aporte a la caja'}</h2>
              <button type="button" className="btn ghost sm" disabled={move.busy}
                onClick={() => setMove(null)}>Cerrar</button>
            </div>
            <p className="hint">
              {move.direction === 'out'
                ? 'Plata que sale de la caja y no es una venta: un gasto, lo que se le pagó a alguien, lo que sacó el dueño.'
                : 'Plata que entra a la caja y no es una venta: sencillo para el vuelto, una devolución.'}
            </p>
            <form onSubmit={onMove} className="vform">
              <label>Cuenta
                <select value={move.accountId}
                  onChange={(e) => setMove((m) => ({ ...m, accountId: e.target.value }))}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.currency === 'USD' ? '$' : 'Bs'})</option>
                  ))}
                </select>
              </label>
              <label>Monto
                <input inputMode="decimal" autoFocus required placeholder="0" value={move.amount}
                  onChange={(e) => setMove((m) => ({ ...m, amount: e.target.value }))} />
              </label>
              <label>Motivo
                <input value={move.reason} placeholder="Delivery, almuerzo, retiro del dueño…"
                  onChange={(e) => setMove((m) => ({ ...m, reason: e.target.value }))} />
              </label>
              {move.error && <div className="form-error">{move.error}</div>}
              <div className="inline-form-actions">
                <button className="btn primary" disabled={move.busy || !move.amount || !move.accountId}>
                  {move.busy ? 'Guardando…' : 'Guardar'}
                </button>
                <button type="button" className="btn ghost" disabled={move.busy}
                  onClick={() => setMove(null)}>Volver</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -------- Cerrar caja: el arqueo -------- */}
      {closing && (
        <div className="modal-backdrop" onClick={() => !closing.busy && setClosing(null)}>
          <div className="modal card modal-wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Cerrar caja</h2>
              <button type="button" className="btn ghost sm" disabled={closing.busy}
                onClick={() => setClosing(null)}>Cerrar</button>
            </div>
            <p className="hint">
              Cuenta el efectivo y escribe cuánto hay de verdad. El cierre guarda las dos cifras
              y su diferencia; después no cambian, aunque se cancele una venta del turno.
            </p>
            <form onSubmit={onClose} className="vform">
              {cashRows.map((r) => {
                const c = num(closing.counted[r.account_id]);
                const dif = c === null ? null : Math.round((c - Number(r.expected)) * 100) / 100;
                return (
                  <div className="arqueo-row" key={r.account_id}>
                    <div className="arqueo-name">
                      <strong>{r.account_name}</strong>
                      <span className="muted">Debería haber {amount(r.expected, r.currency)}</span>
                    </div>
                    <input inputMode="decimal" placeholder="Contado" value={closing.counted[r.account_id] ?? ''}
                      onChange={(e) => setClosing((x) => ({ ...x, counted: { ...x.counted, [r.account_id]: e.target.value } }))} />
                    <span className={`arqueo-dif${dif === null ? '' : dif === 0 ? ' ok' : ' bad'}`}>
                      {dif === null ? '—' : dif === 0 ? 'Cuadra'
                        : `${dif > 0 ? 'Sobra' : 'Falta'} ${amount(Math.abs(dif), r.currency)}`}
                    </span>
                  </div>
                );
              })}
              {otherRows.length > 0 && (
                <div className="totals">
                  {otherRows.map((r) => (
                    <div className="totals-row" key={r.account_id}>
                      <span className="muted">{r.account_name}</span>
                      <span className="muted">{amount(r.sales, r.currency)}</span>
                    </div>
                  ))}
                </div>
              )}
              <label>Nota del cierre (opcional)
                <input value={closing.note} placeholder="Faltó porque se le dio vuelto de más a un cliente…"
                  onChange={(e) => setClosing((c) => ({ ...c, note: e.target.value }))} />
              </label>
              {closing.error && <div className="form-error">{closing.error}</div>}
              <div className="inline-form-actions">
                <button className="btn primary" disabled={closing.busy}>
                  {closing.busy ? 'Cerrando…' : 'Cerrar caja'}
                </button>
                <button type="button" className="btn ghost" disabled={closing.busy}
                  onClick={() => setClosing(null)}>Volver</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -------- Un cierre ya hecho -------- */}
      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal card modal-wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Cierre del {formatDate(detail.closed_at)}</h2>
              <button type="button" className="btn ghost sm" onClick={() => setDetail(null)}>Cerrar</button>
            </div>
            <p className="hint">
              Abrió {who(detail.opened_by)} el {formatDate(detail.opened_at)} y cerró {who(detail.closed_by)}.
              {detail.close_note ? ` ${detail.close_note}` : ''}
            </p>
            <div className="totals">
              {[...(detail.cash_session_lines || [])]
                .sort((a, b) => Number(b.is_cash) - Number(a.is_cash) || a.sort_order - b.sort_order)
                .map((l) => {
                  const dif = l.counted === null ? null
                    : Math.round((Number(l.counted) - Number(l.expected)) * 100) / 100;
                  return (
                    <div className="totals-row" key={l.id}>
                      <span>
                        {l.account_name}
                        {l.is_cash
                          ? <span className="muted"> · fondo {amount(l.opening, l.currency)} · ventas {amount(l.sales, l.currency)}
                            {Number(l.moves_in) > 0 && ` · aportes ${amount(l.moves_in, l.currency)}`}
                            {Number(l.moves_out) > 0 && ` · retiros ${amount(l.moves_out, l.currency)}`}</span>
                          : <span className="muted"> · cobrado por este medio</span>}
                      </span>
                      <span>
                        {l.is_cash ? (
                          <>
                            {amount(l.counted ?? 0, l.currency)}
                            <span className="muted"> de {amount(l.expected, l.currency)}</span>
                            {dif !== null && dif !== 0 && (
                              <span className={`arqueo-dif bad`}> {dif > 0 ? 'sobró' : 'faltó'} {amount(Math.abs(dif), l.currency)}</span>
                            )}
                          </>
                        ) : amount(l.sales, l.currency)}
                      </span>
                    </div>
                  );
                })}
            </div>
            {Number(detail.rate) > 0 && (
              <p className="hint">Tasa al cerrar: {bs(detail.rate)} por dólar.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
