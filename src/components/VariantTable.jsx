// Variaciones de un producto, en dos piezas:
//
// - GenerateDialog: "Varía por" con casillas (Talla, Color, + Otra) y, por
//   cada eje, un desplegable donde se marcan sus valores. Crea de una vez todas
//   las combinaciones (4 tallas × 3 colores = 12 variaciones).
// - VariantTable: las variaciones en una tabla editable (cantidad, precio,
//   costo, SKU, foto) con "Para todas" para llenar en bloque.
//
// Una fila: { key, id?, attributes, stock, price, cost, sku, target?, file?, isNew }
import { useEffect, useRef, useState } from 'react';
import { RowMenu } from './FinUI';
import { sigOf, labelOf, skuFor } from './VariantBuilder';

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
const TRASH = (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d="M5 7h14M10 7V5h4v2M6 7l1 12a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Campo corto que aparece al tocar "+ agregar": Enter confirma, Esc cancela.
function InlineAdd({ label, placeholder, onAdd, busy, closeOnAdd = false, className = 'gv-chip add' }) {
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
      <button type="button" className={className} disabled={busy} onClick={() => setOpen(true)}>
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

// Desplegable con casillas: se ven los elegidos ("S, M, L") y al abrirlo se
// marcan los valores; abajo "＋ Otro…" para escribir uno que no esté.
function MultiValueSelect({ axis, options, value, onToggle, onAdd }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setAdding(false); } };
    // En "click" (fase de captura) y no en mousedown: en celular la lista empuja
    // el contenido, y si se cerrara al presionar, el toque caería en otro lado.
    document.addEventListener('click', off, true);
    return () => document.removeEventListener('click', off, true);
  }, [open]);
  const commit = () => {
    const v = text.trim();
    if (v) onAdd(v);
    setText(''); setAdding(false);
    // Sin lista todavía: el campo sigue abierto para escribir el siguiente.
  };
  const label = value.length ? value.join(', ') : `Elegir ${axis.toLowerCase()}…`;
  return (
    <div className={`mvs${open ? ' open' : ''}`} ref={ref}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); setAdding(false); } }}>
      <button type="button" className={`mvs-trigger${value.length ? '' : ' is-empty'}`} aria-haspopup="listbox"
        aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="mvs-text">{label}</span>
        {value.length > 1 && <span className="gv-count">{value.length}</span>}
      </button>
      {open && (
        <div className="mvs-pop" role="listbox" aria-multiselectable="true">
          {options.map((v) => (
            <label key={v} className="mvs-opt">
              <input type="checkbox" checked={value.includes(v)} onChange={() => onToggle(v)} />
              {v}
            </label>
          ))}
          {adding || !options.length ? (
            <div className="mvs-new">
              <input autoFocus value={text} placeholder={`Nuevo ${axis.toLowerCase()}`}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commit(); }
                  if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); setText(''); }
                }} />
              <button type="button" className="btn primary sm" disabled={!text.trim()} onClick={commit}>Agregar</button>
            </div>
          ) : (
            <button type="button" className="mvs-other" onClick={() => setAdding(true)}>＋ Otro…</button>
          )}
        </div>
      )}
    </div>
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
  onToggleAxis, onGenerate, onClose, busy = false, canStock = true, canPrice = true,
}) {
  // Datos que reciben todas las variaciones nuevas (luego se ajustan en la tabla).
  const [data, setData] = useState({ stock: '', price: '', cost: '', sku: '', file: null });
  const setField = (k, v) => setData((d) => ({ ...d, [k]: v }));
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
    onGenerate(fresh, data);
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

        <div className="vd-axis-picks">
          <span className="muted">Varía por:</span>
          {[...axes, ...offAxes.map((a) => a.name)].map((name) => {
            const on = axes.includes(name);
            const locked = on && lockedAxes.includes(name);
            return (
              <label className={`vd-axis-pick${locked ? ' locked' : ''}`} key={name}
                title={locked ? 'Lo usan las variaciones que ya tiene el producto' : undefined}>
                <input type="checkbox" checked={on} disabled={busy || axisBusy || locked}
                  onChange={(e) => toggleAxis(name, e.target.checked)} />
                {name}
              </label>
            );
          })}
          <InlineAdd label="Otra característica" placeholder="Lado, Material, Sabor…" busy={busy || axisBusy} closeOnAdd
            className="gv-other"
            onAdd={(name) => {
              const known = allAxes.find((a) => norm(a.name) === norm(name));
              if (known && axes.includes(known.name)) return undefined;
              return toggleAxis(known ? known.name : name, true);
            }} />
        </div>

        {axes.length > 0 && (
          <div className="vd-axes">
            {axes.map((a) => (
              <div className="vb-field gv-field" key={a}>
                <span className="gv-field-label">{a}</span>
                <MultiValueSelect axis={a} options={valuesOf(a)} value={picks[a] || []}
                  onToggle={(v) => toggleValue(a, v)} onAdd={(v) => addValue(a, v)} />
              </div>
            ))}
          </div>
        )}

        {axes.length === 0 && (
          <p className="hint gv-empty">Marca en qué varía este producto (talla, color…) o agrega otra característica.</p>
        )}

        {axes.length > 0 && (
          <div className="gv-data">
            <div className="gv-data-head">
              <strong>{fresh.length > 1 ? 'Datos para todas' : 'Datos de la variación'}</strong>
              {fresh.length > 1 && <span className="muted">Luego puedes cambiar cada una en la tabla.</span>}
            </div>
            <div className="vd-data">
              <label className="vd-photo-slot">
                <span className="vd-photo">
                  {data.file ? <img src={URL.createObjectURL(data.file)} alt="" /> : <span className="thumb-ph">＋</span>}
                </span>
                <span className="vd-photo-text">{data.file ? 'Cambiar foto' : 'Foto'}</span>
                <input type="file" accept="image/*" hidden
                  onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) setField('file', f); }} />
              </label>
              <div className="vd-fields">
                {canStock && (
                  <label className="vb-field">{fresh.length > 1 ? 'Cantidad c/u' : 'Cantidad'}
                    <input type="number" min="0" step="1" placeholder="0"
                      value={data.stock} onChange={(e) => setField('stock', e.target.value)} />
                  </label>
                )}
                {canPrice && (
                  <>
                    <label className="vb-field">Precio
                      <input type="number" min="0" step="0.01" placeholder="hereda"
                        value={data.price} onChange={(e) => setField('price', e.target.value)} />
                    </label>
                    <label className="vb-field">Costo
                      <input type="number" min="0" step="0.01" placeholder="hereda"
                        value={data.cost} onChange={(e) => setField('cost', e.target.value)} />
                    </label>
                  </>
                )}
                <label className="vb-field">SKU
                  <input placeholder="opcional" value={data.sku} onChange={(e) => setField('sku', e.target.value)} />
                </label>
              </div>
            </div>
            {fresh.length > 1 && data.sku.trim() && (
              <p className="hint gv-sku-hint">
                Cada una lleva su sufijo: {skuFor(data.sku, axes, fresh[0])}, {skuFor(data.sku, axes, fresh[1])}…
              </p>
            )}
          </div>
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
