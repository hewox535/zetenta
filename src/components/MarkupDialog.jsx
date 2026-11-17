// Precio de venta por margen: precio = costo × (1 + margen %). Se aplica de
// una vez a los productos (y a las variantes con costo propio) con la RPC
// apply_price_markup; aquí solo se arma la vista previa con la misma fórmula.
import { useMemo, useState } from 'react';
import { FinModal } from './FinUI';
import { money, priceWithMarkup } from '../lib/calc';
import { applyPriceMarkup } from '../lib/api';

const PRESETS = [30, 50, 80, 100];
const ROUNDS = [
  { key: 'none', label: 'Exacto' },
  { key: 'int', label: 'Al dólar' },
  { key: '99', label: 'Termina en ,99' },
];

export default function MarkupDialog({ products, onClose, onApplied }) {
  const [percent, setPercent] = useState('100');
  const [scope, setScope] = useState(() => (products.some((p) => !(Number(p.price) > 0)) ? 'missing' : 'all'));
  const [round, setRound] = useState('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const pct = Number(String(percent).replace(',', '.'));
  const validPct = Number.isFinite(pct) && pct >= 0 && pct <= 1000 && String(percent).trim() !== '';

  const { targets, missing, skipped } = useMemo(() => {
    const inScope = (p) => scope === 'all' || !(Number(p.price) > 0);
    const list = products.filter(inScope);
    return {
      targets: list.filter((p) => Number(p.cost) > 0),
      missing: products.filter((p) => !(Number(p.price) > 0)).length,
      skipped: list.filter((p) => !(Number(p.cost) > 0)).length,
    };
  }, [products, scope]);

  const sample = targets.slice(0, 4);

  async function submit(e) {
    e.preventDefault();
    if (!validPct) { setError('Escribe un margen entre 0 y 1000 %.'); return; }
    if (!targets.length) { setError('No hay productos con costo para calcularles el precio.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await applyPriceMarkup({ percent: pct, scope, round });
      onApplied(res);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <FinModal title="Precio de venta por margen" wide busy={busy} onClose={onClose} onSubmit={submit}
      sub="Calcula el precio de venta a partir del costo de cada prenda."
      footer={(
        <>
          <span className="mk-summary">
            {targets.length > 0
              ? <><strong>{targets.length === 1 ? '1 producto' : `${targets.length} productos`}</strong>{skipped > 0 ? ` · ${skipped} sin costo se saltan` : ''}</>
              : 'Ningún producto con costo en este grupo'}
          </span>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={busy || !targets.length || !validPct}>
            {busy ? 'Aplicando…' : 'Aplicar precios'}
          </button>
        </>
      )}>
      <div className="mk-field">
        <span className="mk-label">Margen sobre el costo</span>
        <div className="mk-pct-row">
          <div className="mk-chips" role="group" aria-label="Márgenes frecuentes">
            {PRESETS.map((n) => (
              <button key={n} type="button" className={`mk-chip${pct === n && validPct ? ' on' : ''}`}
                aria-pressed={pct === n} onClick={() => { setPercent(String(n)); setError(null); }}>
                {n} %
              </button>
            ))}
          </div>
          <label className="mk-pct">
            <input inputMode="decimal" value={percent} aria-label="Margen en porcentaje"
              onChange={(e) => { setPercent(e.target.value); setError(null); }} />
            <span aria-hidden="true">%</span>
          </label>
        </div>
        {validPct && <p className="hint">Una prenda que te costó $10 se venderá a <strong>${money(priceWithMarkup(10, pct, round))}</strong>.</p>}
      </div>

      <div className="mk-field">
        <span className="mk-label">A qué productos</span>
        <div className="mk-options">
          <label className={`mk-option${scope === 'missing' ? ' on' : ''}`}>
            <input type="radio" name="mk-scope" checked={scope === 'missing'} onChange={() => setScope('missing')} />
            <span><strong>Solo los que no tienen precio</strong><small>{missing === 1 ? '1 producto' : `${missing} productos`} · no toca los precios que ya pusiste</small></span>
          </label>
          <label className={`mk-option${scope === 'all' ? ' on' : ''}`}>
            <input type="radio" name="mk-scope" checked={scope === 'all'} onChange={() => setScope('all')} />
            <span><strong>Todos</strong><small>Recalcula también los que ya tienen precio</small></span>
          </label>
        </div>
      </div>

      <div className="mk-field">
        <span className="mk-label">Redondeo</span>
        <div className="mk-seg" role="radiogroup" aria-label="Redondeo">
          {ROUNDS.map((r) => (
            <button key={r.key} type="button" role="radio" aria-checked={round === r.key}
              className={`mk-seg-btn${round === r.key ? ' on' : ''}`} onClick={() => setRound(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {validPct && sample.length > 0 && (
        <div className="mk-preview">
          <div className="mk-preview-head"><span>Producto</span><span>Costo</span><span>Precio de venta</span></div>
          {sample.map((p) => (
            <div className="mk-preview-row" key={p.id}>
              <span className="mk-name">{p.name}</span>
              <span className="num muted">${money(p.cost)}</span>
              <span className="num">
                {Number(p.price) > 0 && <s className="muted">${money(p.price)}</s>}
                <strong>${money(priceWithMarkup(Number(p.cost), pct, round))}</strong>
              </span>
            </div>
          ))}
          {targets.length > sample.length && <div className="mk-more">y {targets.length - sample.length} más</div>}
        </div>
      )}

      {skipped > 0 && (
        <p className="mk-note">{skipped === 1 ? '1 producto no tiene costo: queda sin precio' : `${skipped} productos no tienen costo: quedan sin precio`} hasta que le pongas el costo o el precio a mano.</p>
      )}

      {error && <div className="form-error">{error}</div>}
    </FinModal>
  );
}
