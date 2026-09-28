// Constructor de variaciones: se eligen los valores de cada eje (Talla: S, M;
// Color: Negro, Blanco) y las combinaciones salen solas (S·Negro, S·Blanco…).
// Cada combinación es una tarjeta con su foto, cantidad, SKU, precio y costo.
//
// El estado vive en el padre como un solo objeto:
//   { values: { Talla: ['S','M'] }, data: { 'S|Negro': {stock, sku, price, cost, file} },
//     removed: ['M|Negro'] }
// Las combinaciones no se guardan una por una: se calculan de `values` y se
// cruzan con `data` (lo escrito) y `removed` (las que el usuario quitó), así
// marcar un valor nuevo nunca borra lo ya escrito en las demás.
import { useRef, useState } from 'react';

export const emptyBuilder = () => ({ values: {}, data: {}, removed: [] });

export const sigOf = (axisNames, attrs) => axisNames.map((a) => attrs[a] ?? '').join('|');

// Producto cartesiano de los valores elegidos, en el orden de los ejes.
function combosOf(axisNames, values) {
  let out = [{}];
  for (const name of axisNames) {
    const vals = values[name] || [];
    if (vals.length === 0) return [];
    out = out.flatMap((combo) => vals.map((v) => ({ ...combo, [name]: v })));
  }
  return out;
}

// Las variaciones que se van a crear: combinaciones vigentes, sin las quitadas
// ni las que ya existen en el producto, con lo escrito en cada una.
export function builderVariants(axisNames, state, existingSigs = new Set()) {
  const removed = new Set(state.removed || []);
  return combosOf(axisNames, state.values || {})
    .map((attrs) => ({ sig: sigOf(axisNames, attrs), attributes: attrs }))
    .filter(({ sig }) => !removed.has(sig) && !existingSigs.has(sig))
    .map(({ sig, attributes }) => ({ sig, attributes, ...(state.data?.[sig] || {}) }));
}

const TRASH = (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d="M5 7h14M10 7V5h4v2M6 7l1 12a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Chips de valores de un eje, con campo para escribir uno que no esté en la lista.
function AxisValues({ axis, selected, onChange }) {
  const [extra, setExtra] = useState('');
  const names = axis.terms.map((t) => t.name);
  const custom = selected.filter((v) => !names.includes(v));
  const toggle = (v) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  function addExtra() {
    const v = extra.trim();
    if (!v) return;
    if (!selected.includes(v)) onChange([...selected, v]);
    setExtra('');
  }

  return (
    <div className="axis-values">
      <div className="axis-values-head">
        <span className="axis-name">{axis.name}</span>
        {selected.length > 0 && (
          <button type="button" className="linklike" onClick={() => onChange([])}>Ninguno</button>
        )}
      </div>
      <div className="chip-row">
        {[...names, ...custom].map((v) => (
          <button type="button" key={v} className={`chip${selected.includes(v) ? ' on' : ''}`}
            aria-pressed={selected.includes(v)} onClick={() => toggle(v)}>{v}</button>
        ))}
        <span className="chip-add">
          <input value={extra} placeholder={`Otro ${axis.name.toLowerCase()}…`}
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExtra(); } }} />
          <button type="button" className="btn ghost sm" disabled={!extra.trim()} onClick={addExtra}>Agregar</button>
        </span>
      </div>
    </div>
  );
}

export default function VariantBuilder({
  axes, state, onChange, existingSigs = new Set(), allowImages = true, disabled = false,
}) {
  const axisNames = axes.map((a) => a.name);
  const [bulk, setBulk] = useState({ stock: '', price: '' });
  const fileInputs = useRef({});

  const variants = builderVariants(axisNames, state, existingSigs);
  const removed = (state.removed || []).filter((sig) => {
    // Solo cuentan las quitadas que siguen siendo combinaciones posibles.
    const all = combosOf(axisNames, state.values || {}).map((a) => sigOf(axisNames, a));
    return all.includes(sig);
  });

  const setValues = (name, vals) => onChange({ ...state, values: { ...state.values, [name]: vals } });
  const patchRow = (sig, patch) => onChange({
    ...state, data: { ...state.data, [sig]: { ...(state.data?.[sig] || {}), ...patch } },
  });
  const removeRow = (sig) => onChange({ ...state, removed: [...(state.removed || []), sig] });
  const restoreAll = () => onChange({ ...state, removed: [] });

  function applyBulk() {
    const data = { ...state.data };
    for (const v of variants) {
      data[v.sig] = { ...(data[v.sig] || {}) };
      if (bulk.stock !== '') data[v.sig].stock = bulk.stock;
      if (bulk.price !== '') data[v.sig].price = bulk.price;
    }
    onChange({ ...state, data });
    setBulk({ stock: '', price: '' });
  }

  const pendingAxes = axes.filter((a) => (state.values?.[a.name] || []).length === 0);

  return (
    <div className="vb">
      {axes.map((axis) => (
        <AxisValues key={axis.id ?? axis.name} axis={axis}
          selected={state.values?.[axis.name] || []}
          onChange={(vals) => setValues(axis.name, vals)} />
      ))}

      {pendingAxes.length > 0 ? (
        <p className="hint">
          Elige {pendingAxes.length === 1 ? 'los valores de' : 'los valores de'}{' '}
          <strong>{pendingAxes.map((a) => a.name).join(' y ')}</strong> para armar las variaciones.
        </p>
      ) : variants.length === 0 ? (
        <p className="hint">
          Todas las combinaciones están quitadas o ya existen en el producto.
          {removed.length > 0 && <> <button type="button" className="linklike" onClick={restoreAll}>Restaurar las quitadas</button></>}
        </p>
      ) : (
        <>
          <div className="vb-bar">
            <strong>{variants.length} {variants.length === 1 ? 'variación' : 'variaciones'}</strong>
            <span className="vb-bar-gap" />
            <span className="muted">Para todas:</span>
            <input type="number" min="0" step="1" placeholder="cantidad" className="vb-bulk"
              value={bulk.stock} onChange={(e) => setBulk((b) => ({ ...b, stock: e.target.value }))} />
            <input type="number" min="0" step="0.01" placeholder="precio" className="vb-bulk"
              value={bulk.price} onChange={(e) => setBulk((b) => ({ ...b, price: e.target.value }))} />
            <button type="button" className="btn ghost sm" disabled={disabled || (bulk.stock === '' && bulk.price === '')}
              onClick={applyBulk}>Aplicar</button>
            {removed.length > 0 && (
              <button type="button" className="linklike" onClick={restoreAll}>
                Restaurar {removed.length} quitada{removed.length === 1 ? '' : 's'}
              </button>
            )}
          </div>

          <div className="vb-list">
            {variants.map((v) => {
              const label = axisNames.map((a) => v.attributes[a]).join(' · ');
              return (
                <div className="vb-card" key={v.sig}>
                  {allowImages && (
                    <label className="vb-photo" title={`Foto de ${label}`}>
                      {v.file
                        ? <img src={URL.createObjectURL(v.file)} alt="" />
                        : <span className="thumb-ph">＋</span>}
                      <input type="file" accept="image/*" hidden disabled={disabled}
                        ref={(el) => { fileInputs.current[v.sig] = el; }}
                        onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) patchRow(v.sig, { file: f }); }} />
                    </label>
                  )}
                  <div className="vb-card-body">
                    <div className="vb-card-head">
                      <span className="vb-label">{label}</span>
                      {v.file && (
                        <button type="button" className="linklike" onClick={() => patchRow(v.sig, { file: null })}>
                          quitar foto
                        </button>
                      )}
                      <button type="button" className="vb-del" title="Quitar esta variación"
                        aria-label={`Quitar ${label}`} onClick={() => removeRow(v.sig)}>{TRASH}</button>
                    </div>
                    <div className="vb-fields">
                      <label className="vb-field">Cantidad
                        <input type="number" min="0" step="1" placeholder="0" disabled={disabled}
                          value={v.stock ?? ''} onChange={(e) => patchRow(v.sig, { stock: e.target.value })} />
                      </label>
                      <label className="vb-field">Precio
                        <input type="number" min="0" step="0.01" placeholder="hereda" disabled={disabled}
                          value={v.price ?? ''} onChange={(e) => patchRow(v.sig, { price: e.target.value })} />
                      </label>
                      <label className="vb-field">Costo
                        <input type="number" min="0" step="0.01" placeholder="hereda" disabled={disabled}
                          value={v.cost ?? ''} onChange={(e) => patchRow(v.sig, { cost: e.target.value })} />
                      </label>
                      <label className="vb-field">SKU
                        <input placeholder="opcional" disabled={disabled}
                          value={v.sku ?? ''} onChange={(e) => patchRow(v.sig, { sku: e.target.value })} />
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
