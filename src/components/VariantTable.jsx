// Variaciones de un producto, en dos piezas:
//
// - GenerateDialog: "¿En qué varía?" (Talla, Color, + Otra característica) y,
//   por cada eje, los valores como chips. Crea de una vez todas las
//   combinaciones (4 tallas × 3 colores = 12 variaciones).
// - VariantTable: las variaciones en una tabla editable (cantidad, precio,
//   costo, SKU, foto) con "Para todas" para llenar en bloque.
//
// Una fila: { key, id?, attributes, stock, price, cost, sku, target?, file?, isNew }
import { useState } from 'react';
import { RowMenu } from './FinUI';
import { sigOf, labelOf } from './VariantBuilder';

// Todas las combinaciones de los valores elegidos: [{Talla:'S',Color:'Negro'}, …]
function combos(axes, picks) {
  let out = [{}];
  for (const a of axes) {
    const vals = picks[a] || [];
    out = out.flatMap((c) => vals.map((v) => ({ ...c, [a]: v })));
  }
  return out;
}

const norm = (s) => s.trim().toLowerCase();

const PLUS = <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const CHECK = <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M5 12.5l4.2 4L19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const TRASH = (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d="M5 7h14M10 7V5h4v2M6 7l1 12a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Campo corto que aparece al tocar "+ agregar": Enter confirma, Esc cancela.
function InlineAdd({ label, placeholder, onAdd, busy, closeOnAdd = false }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const commit = async () => {
    const v = text.trim();
    if (!v) { setOpen(false); return; }
    await onAdd(v);
    setText('');
    if (closeOnAdd) setOpen(false);
  };
  if (!open) {
    return (
      <button type="button" className="gv-chip add" disabled={busy} onClick={() => setOpen(true)}>
        {PLUS}{label}
      </button>
    );
  }
  return (
    <span className="gv-add">
      <input autoFocus value={text} placeholder={placeholder} disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); setText(''); }
        }}
        onBlur={() => { if (!text.trim()) setOpen(false); }} />
      <button type="button" className="btn primary sm" disabled={busy || !text.trim()} onClick={commit}>Agregar</button>
    </span>
  );
}

// ============================================================
// Modal: generar variaciones
// ============================================================
// allAxes: ejes del negocio [{ name, terms: [{name}] }]
// selected: nombres de los ejes del producto
// usedValues: { Talla: ['M', …] } valores que ya usan sus variaciones (se
//   muestran como chips aunque no estén en la lista del negocio)
// taken: firmas que ya existen (no se repiten)
// onToggleAxis(name, on): marca/desmarca o crea un eje (async)
export function GenerateDialog({
  allAxes, selected, lockedAxes = [], usedValues = {}, taken, existingCount = 0,
  onToggleAxis, onGenerate, onClose, busy = false,
}) {
  const [picks, setPicks] = useState({});        // { Talla: ['S','M'] }
  const [extra, setExtra] = useState({});        // valores escritos a mano por eje
  const [error, setError] = useState(null);
  const [axisBusy, setAxisBusy] = useState(false);

  const axes = selected;
  const valuesOf = (a) => {
    const base = (allAxes.find((x) => x.name === a)?.terms || []).map((t) => t.name);
    const seen = new Set(base.map(norm));
    const more = [...(usedValues[a] || []), ...(extra[a] || [])].filter((v) => !seen.has(norm(v)) && seen.add(norm(v)));
    return [...base, ...more];
  };
  const toggleValue = (a, v) => {
    setError(null);
    setPicks((p) => {
      const cur = p[a] || [];
      return { ...p, [a]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    });
  };
  const addValue = (a, v) => {
    const existing = valuesOf(a).find((x) => norm(x) === norm(v));
    const val = existing || v;
    if (!existing) setExtra((e) => ({ ...e, [a]: [...(e[a] || []), v] }));
    setPicks((p) => ({ ...p, [a]: (p[a] || []).includes(val) ? p[a] : [...(p[a] || []), val] }));
  };
  async function toggleAxis(name, on) {
    setError(null); setAxisBusy(true);
    try { await onToggleAxis(name, on); } catch (e) { setError(e.message); } finally { setAxisBusy(false); }
    if (!on) setPicks((p) => { const n = { ...p }; delete n[name]; return n; });
  }

  const missing = axes.filter((a) => !(picks[a] || []).length);
  const all = axes.length && !missing.length ? combos(axes, picks) : [];
  const fresh = all.filter((c) => !taken.has(sigOf(axes, c)));
  const repeated = all.length - fresh.length;
  const newAxisForExisting = existingCount > 0 && axes.some((a) => !lockedAxes.includes(a));

  function submit() {
    if (!axes.length) { setError('Elige en qué varía el producto.'); return; }
    if (missing.length) { setError(`Elige al menos un valor de ${missing[0].toLowerCase()}.`); return; }
    if (!fresh.length) { setError('Esas variaciones ya existen.'); return; }
    onGenerate(fresh);
  }

  const offAxes = allAxes.filter((a) => !axes.includes(a.name));

  return (
    <div className="modal-backdrop stacked" onClick={onClose}>
      <div className="modal card gv-modal" role="dialog" aria-modal="true" aria-labelledby="gv-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <div className="modal-head">
          <h2 id="gv-title">Agregar variaciones</h2>
          <button type="button" className="btn ghost sm" onClick={onClose}>Cerrar</button>
        </div>

        <div className="gv-step">
          <div className="gv-step-label">¿En qué varía?</div>
          <div className="gv-chips">
            {[...axes, ...offAxes.map((a) => a.name)].map((name) => {
              const on = axes.includes(name);
              const locked = on && lockedAxes.includes(name);
              return (
                <button type="button" key={name} aria-pressed={on}
                  className={`gv-chip axis${on ? ' on' : ''}${locked ? ' locked' : ''}`}
                  disabled={busy || axisBusy || locked}
                  title={locked ? 'Lo usan las variaciones que ya tiene el producto' : undefined}
                  onClick={() => toggleAxis(name, !on)}>
                  {on && CHECK}{name}
                </button>
              );
            })}
            <InlineAdd label="Otra característica" placeholder="Lado, Material, Sabor…" busy={busy || axisBusy} closeOnAdd
              onAdd={(name) => {
                const known = allAxes.find((a) => norm(a.name) === norm(name));
                if (known && axes.includes(known.name)) return undefined;
                return toggleAxis(known ? known.name : name, true);
              }} />
          </div>
        </div>

        {axes.map((a) => (
          <div className="gv-step" key={a}>
            <div className="gv-step-label">
              {a}
              {(picks[a] || []).length > 0 && <span className="gv-count">{picks[a].length}</span>}
            </div>
            <div className="gv-chips">
              {valuesOf(a).map((v) => {
                const on = (picks[a] || []).includes(v);
                return (
                  <button type="button" key={v} aria-pressed={on} className={`gv-chip${on ? ' on' : ''}`}
                    onClick={() => toggleValue(a, v)}>
                    {on && CHECK}{v}
                  </button>
                );
              })}
              <InlineAdd label={valuesOf(a).length ? 'Agregar' : `Escribe ${a.toLowerCase()}`}
                placeholder={`Nuevo valor de ${a.toLowerCase()}`} onAdd={(v) => addValue(a, v)} />
            </div>
          </div>
        ))}

        {axes.length === 0 && (
          <p className="hint gv-empty">Toca una característica (o crea la tuya) para elegir sus valores.</p>
        )}

        {newAxisForExisting && (
          <p className="gv-note">
            Las variaciones que ya tienes quedarán sin {axes.filter((a) => !lockedAxes.includes(a)).join(' ni ').toLowerCase()}:
            complétalo en la tabla.
          </p>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="gv-foot">
          <span className="gv-summary" aria-live="polite">
            {fresh.length > 0
              ? <><strong>{fresh.length === 1 ? '1 variación nueva' : `${fresh.length} variaciones nuevas`}</strong>{repeated > 0 ? ` · ${repeated} ya existen` : ''}</>
              : axes.length ? 'Elige los valores' : ''}
          </span>
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn primary" disabled={busy || !fresh.length} onClick={submit}>
            {fresh.length > 1 ? `Crear ${fresh.length} variaciones` : 'Crear variación'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tabla de variaciones
// ============================================================

// Valor que le falta a una variación (se sumó un eje): desplegable en la celda.
function MissingValue({ axis, terms, onChange }) {
  const [custom, setCustom] = useState(false);
  if (custom) {
    return (
      <input className="vt-missing" autoFocus placeholder={axis}
        onBlur={(e) => { if (e.target.value.trim()) onChange(e.target.value.trim()); else setCustom(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
    );
  }
  return (
    <select className="vt-missing" value="" aria-label={`Elegir ${axis.toLowerCase()}`}
      onChange={(e) => (e.target.value === '__new__' ? setCustom(true) : onChange(e.target.value))}>
      <option value="">{axis}…</option>
      {terms.map((t) => <option key={t} value={t}>{t}</option>)}
      <option value="__new__">＋ Otro…</option>
    </select>
  );
}

// rows: filas (ver arriba). photoOf(row) → url | null.
// onPatch(key, patch), onRemove(row) quita una fila nueva, menuFor(row) → ítems ⋯
// lock: { stock, price, info, media }. showTarget: columna de stock objetivo.
export function VariantTable({
  axes, rows, termsOf, onPatch, onBulk, onRemove, onPhoto, photoOf, menuFor,
  lock = {}, showTarget = false, disabled = false, photoHint,
}) {
  const [bulk, setBulk] = useState({ stock: '', price: '', cost: '' });
  const total = rows.reduce((s, r) => s + (Number(r.stock) || 0), 0);
  const cls = `vt-row${showTarget ? ' with-target' : ''}`;

  function applyBulk() {
    const patch = {};
    for (const k of ['stock', 'price', 'cost']) if (bulk[k] !== '') patch[k] = bulk[k];
    onBulk(patch);
    setBulk({ stock: '', price: '', cost: '' });
  }
  const bulkEmpty = bulk.stock === '' && bulk.price === '' && bulk.cost === '';

  return (
    <div className="vt">
      {rows.length > 1 && (
        <div className="vt-bulk">
          <span className="vt-bulk-label">Para todas</span>
          {!lock.stock && <input type="number" min="0" step="1" placeholder="Cantidad" value={bulk.stock} disabled={disabled}
            onChange={(e) => setBulk((b) => ({ ...b, stock: e.target.value }))} />}
          {!lock.price && <input type="number" min="0" step="0.01" placeholder="Precio" value={bulk.price} disabled={disabled}
            onChange={(e) => setBulk((b) => ({ ...b, price: e.target.value }))} />}
          {!lock.price && <input type="number" min="0" step="0.01" placeholder="Costo" value={bulk.cost} disabled={disabled}
            onChange={(e) => setBulk((b) => ({ ...b, cost: e.target.value }))} />}
          <button type="button" className="btn ghost sm" disabled={disabled || bulkEmpty} onClick={applyBulk}>Aplicar</button>
        </div>
      )}

      <div className="vt-table" role="table" aria-label="Variaciones">
        <div className={`${cls} vt-head`} role="row">
          <span role="columnheader" aria-label="Foto" />
          <span role="columnheader">Variación</span>
          <span role="columnheader">Cantidad</span>
          <span role="columnheader">Precio</span>
          <span role="columnheader">Costo</span>
          <span role="columnheader">SKU</span>
          {showTarget && <span role="columnheader" title="Stock que quieres tener; avisa cuando baja">Objetivo</span>}
          <span role="columnheader" aria-label="Acciones" />
        </div>
        {rows.map((r) => {
          const photo = photoOf(r);
          const missing = axes.filter((a) => !r.attributes?.[a]);
          return (
            <div className={`${cls}${r.isNew && rows.some((x) => !x.isNew) ? ' is-new' : ''}`} role="row" key={r.key}>
              <label className={`vt-photo${lock.media ? ' locked' : ''}`} title={lock.media ? '' : 'Foto de esta variación'}>
                {photo ? <img src={photo} alt="" /> : <span aria-hidden="true">{lock.media ? '' : PLUS}</span>}
                <input type="file" accept="image/*" hidden disabled={disabled || lock.media}
                  onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onPhoto(r, f); }} />
              </label>
              <div className="vt-name" role="cell">
                {axes.map((a) => (r.attributes?.[a] ? (
                  <span className="vt-val" key={a} title={a}>{r.attributes[a]}</span>
                ) : (
                  <MissingValue key={a} axis={a} terms={termsOf(a)}
                    onChange={(v) => onPatch(r.key, { attributes: { ...r.attributes, [a]: v } })} />
                )))}
                {axes.length === 0 && <span className="vt-val">Estándar</span>}
                {r.isNew && rows.some((x) => !x.isNew) && <span className="vt-new">Nueva</span>}
                {missing.length > 0 && <span className="sr-only">Falta {missing.join(', ')}</span>}
              </div>
              <label className="vt-cell" data-label="Cantidad">
                <input type="number" min="0" step="1" placeholder="0" value={r.stock} disabled={disabled || lock.stock}
                  aria-label="Cantidad" onChange={(e) => onPatch(r.key, { stock: e.target.value })} />
              </label>
              <label className="vt-cell" data-label="Precio">
                <input type="number" min="0" step="0.01" placeholder="hereda" value={r.price} disabled={disabled || lock.price}
                  aria-label="Precio" onChange={(e) => onPatch(r.key, { price: e.target.value })} />
              </label>
              <label className="vt-cell" data-label="Costo">
                <input type="number" min="0" step="0.01" placeholder="hereda" value={r.cost} disabled={disabled || lock.price}
                  aria-label="Costo" onChange={(e) => onPatch(r.key, { cost: e.target.value })} />
              </label>
              <label className="vt-cell" data-label="SKU">
                <input placeholder="—" value={r.sku} disabled={disabled || lock.info}
                  aria-label="SKU" onChange={(e) => onPatch(r.key, { sku: e.target.value })} />
              </label>
              {showTarget && (
                <label className="vt-cell" data-label="Objetivo">
                  <input type="number" min="0" step="1" placeholder="—" value={r.target ?? ''} disabled={disabled || lock.stock || r.isNew}
                    aria-label="Stock objetivo" onChange={(e) => onPatch(r.key, { target: e.target.value })} />
                </label>
              )}
              <div className="vt-actions">
                {r.isNew ? (
                  <button type="button" className="vt-del" disabled={disabled} title="Quitar esta variación"
                    aria-label={`Quitar ${labelOf(axes, r.attributes) || 'variación'}`} onClick={() => onRemove(r)}>{TRASH}</button>
                ) : (
                  <RowMenu items={menuFor ? menuFor(r) : []} label={`Acciones de ${labelOf(axes, r.attributes) || 'la variación'}`} />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="vt-foot">
        <span>{rows.length === 1 ? '1 variación' : `${rows.length} variaciones`} · <strong>{total} und</strong> en total</span>
        {photoHint && <span className="muted">{photoHint}</span>}
      </div>
    </div>
  );
}
