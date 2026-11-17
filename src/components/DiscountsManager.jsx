// Descuentos especiales (Negocio → Ventas): Black Friday, liquidaciones…
// Cada uno tiene nombre, cuánto si se paga de contado y cuánto con Cashea, y
// entre qué fechas está disponible. En el cobro la cajera elige cuál aplica a
// la venta, y la venta guarda cuál fue.
import { useEffect, useState } from 'react';
import { FinModal } from './FinUI';
import { useConfirm } from './Confirm';
import { fetchDiscounts, saveDiscount, deleteDiscount } from '../lib/api';
import { discountStatus, todayVE } from '../lib/discounts';
import { usd } from '../lib/calc';
import './discounts.css';

const STATUS = {
  live: { label: 'Activo', tone: 'live' },
  soon: { label: 'Programado', tone: 'soon' },
  ended: { label: 'Terminó', tone: 'off' },
  off: { label: 'Pausado', tone: 'off' },
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-VE', { day: 'numeric', month: 'short' }).replace('.', '');
};
const rangeText = (ds) => {
  if (ds.starts_on && ds.ends_on) return ds.starts_on === ds.ends_on ? `Solo el ${fmtDate(ds.starts_on)}` : `${fmtDate(ds.starts_on)} → ${fmtDate(ds.ends_on)}`;
  if (ds.starts_on) return `Desde el ${fmtDate(ds.starts_on)}`;
  if (ds.ends_on) return `Hasta el ${fmtDate(ds.ends_on)}`;
  return 'Sin fecha de fin';
};

export default function DiscountsManager({ business }) {
  const ask = useConfirm();
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);   // descuento (o {} si es nuevo)
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchDiscounts().then(setList).catch((e) => { setList([]); setError(e.message); });
  }, []);
  async function toggle(ds) {
    const prev = list;
    setList((l) => l.map((x) => (x.id === ds.id ? { ...x, active: !x.active } : x)));
    try { await saveDiscount(business.id, { id: ds.id, active: !ds.active }); }
    catch (e) { setList(prev); setError(e.message); }
  }

  async function remove(ds) {
    if (!await ask({ title: `¿Eliminar "${ds.name}"?`, message: 'Deja de aplicarse en las ventas nuevas. Las ventas ya hechas conservan su descuento.', confirmLabel: 'Eliminar' })) return false;
    await deleteDiscount(ds.id);
    setList((l) => l.filter((x) => x.id !== ds.id));
    return true;
  }

  const today = todayVE();

  return (
    <section className="card vsection">
      <div className="ds-head">
        <div>
          <h2>Descuentos especiales</h2>
          <p className="hint">
            Para temporadas como Black Friday. Aparecen en el cobro con su nombre y la cajera elige cuál
            aplica a la venta; queda registrado en la venta y en el historial. No se suma al descuento de
            contado: se aplica el mayor.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={() => setEditing({})}>+ Nuevo descuento</button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {list && list.length === 0 && (
        <button type="button" className="ds-empty" onClick={() => setEditing({})}>
          <strong>Aún no hay descuentos</strong>
          <span>Ej.: «Black Friday · Ropa»: 40% pagando de contado y 20% con Cashea.</span>
        </button>
      )}

      {list && list.length > 0 && (
        <div className="ds-list">
          {list.map((ds) => {
            const st = STATUS[discountStatus(ds, today)];
            return (
              <div className={`ds-row ${st.tone}`} key={ds.id}>
                <button type="button" className="ds-main" onClick={() => setEditing(ds)}>
                  <span className="ds-title">
                    <span className="ds-name">{ds.name}</span>
                    <span className={`ds-status ${st.tone}`}>{st.label}</span>
                  </span>
                  <span className="ds-sub">{rangeText(ds)}</span>
                </button>
                <span className="ds-pcts">
                  {Number(ds.cash_percent) > 0 && <span className="ds-pct"><b>−{Number(ds.cash_percent)}%</b> contado</span>}
                  {Number(ds.cashea_percent) > 0 && <span className="ds-pct cashea"><b>−{Number(ds.cashea_percent)}%</b> Cashea</span>}
                </span>
                <button type="button" className={`switch${ds.active ? ' on' : ''}`} role="switch" aria-checked={ds.active}
                  aria-label={ds.active ? 'Pausar' : 'Activar'} onClick={() => toggle(ds)}>
                  <span className="switch-knob" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <DiscountEditor business={business} initial={editing}
          onClose={() => setEditing(null)}
          onDelete={editing.id ? async () => { if (await remove(editing)) setEditing(null); } : null}
          onSaved={(row) => {
            setList((l) => (l.some((x) => x.id === row.id) ? l.map((x) => (x.id === row.id ? row : x)) : [...l, row]));
            setEditing(null);
          }} />
      )}
    </section>
  );
}

function DiscountEditor({ business, initial, onClose, onSaved, onDelete }) {
  const [name, setName] = useState(initial.name || '');
  const [cash, setCash] = useState(initial.cash_percent != null ? String(Number(initial.cash_percent)) : '');
  const [cashea, setCashea] = useState(initial.cashea_percent != null ? String(Number(initial.cashea_percent)) : '');
  const [from, setFrom] = useState(initial.starts_on || '');
  const [to, setTo] = useState(initial.ends_on || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const num = (v) => (String(v).trim() === '' ? null : Number(String(v).replace(',', '.')));
  const cashN = num(cash); const casheaN = num(cashea);
  const pctOk = (n) => n === null || (Number.isFinite(n) && n >= 0 && n < 100);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return setError('Ponle un nombre, p. ej. «Black Friday · Ropa».');
    if (!pctOk(cashN) || !pctOk(casheaN)) return setError('Los porcentajes van de 0 a 99.');
    if (!(cashN > 0) && !(casheaN > 0)) return setError('Escribe el % de contado, el de Cashea o ambos.');
    if (from && to && to < from) return setError('La fecha de fin es anterior a la de inicio.');
    setBusy(true); setError(null);
    try {
      const row = await saveDiscount(business.id, {
        id: initial.id, name: name.trim(),
        cash_percent: cashN, cashea_percent: casheaN,
        starts_on: from || null, ends_on: to || null,
        active: initial.active ?? true,
      });
      onSaved(row);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  // Ejemplo con un producto de $100 para que se entienda de un vistazo.
  const sample = (cashN > 0 || casheaN > 0) && (
    <p className="hint ds-sample">
      Un producto de $100 queda en
      {cashN > 0 && <> <strong>{usd(100 * (1 - cashN / 100))}</strong> de contado</>}
      {cashN > 0 && casheaN > 0 && ' y en'}
      {casheaN > 0 && <> <strong>{usd(100 * (1 - casheaN / 100))}</strong> con Cashea</>}.
    </p>
  );

  return (
    <FinModal title={initial.id ? 'Editar descuento' : 'Nuevo descuento'} wide busy={busy} onClose={onClose} onSubmit={submit}
      sub="Aparece en el cobro para que la cajera lo elija."
      footer={(
        <>
          {onDelete && <button type="button" className="btn ghost danger ds-del" disabled={busy} onClick={onDelete}>Eliminar</button>}
          <span className="ds-cover" />
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <label className="ds-field">
        <span className="ds-label">Nombre</span>
        <input value={name} onChange={(e) => { setName(e.target.value); setError(null); }}
          placeholder="Black Friday · Ropa" maxLength={60} autoFocus={!initial.id} />
        <span className="field-hint">Así lo verá la cajera al cobrar y quedará en la venta.</span>
      </label>

      <div className="ds-field">
        <span className="ds-label">Descuento</span>
        <div className="ds-pct-grid">
          <label className="ds-pct-box">
            <span>Pagando de contado</span>
            <span className="ds-pct-input">
              <input inputMode="decimal" value={cash} placeholder="0" onChange={(e) => { setCash(e.target.value); setError(null); }} />
              <i>%</i>
            </span>
            <small>Bolívares o divisa</small>
          </label>
          <label className="ds-pct-box">
            <span>Con Cashea</span>
            <span className="ds-pct-input">
              <input inputMode="decimal" value={cashea} placeholder="0" onChange={(e) => { setCashea(e.target.value); setError(null); }} />
              <i>%</i>
            </span>
            <small>Vacío si no aplica</small>
          </label>
        </div>
        {sample}
      </div>

      <div className="ds-field">
        <span className="ds-label">Vigencia</span>
        <div className="ds-dates">
          <label><span>Desde</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label><span>Hasta</span><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <span className="field-hint">Opcional. Empieza y se apaga solo en esas fechas (inclusive).</span>
      </div>

      {error && <div className="form-error">{error}</div>}
    </FinModal>
  );
}
