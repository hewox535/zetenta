// Variaciones de un producto: una lista de tarjetas (foto, cantidad, precio,
// costo, SKU) y un botón que abre un submodal para armar la siguiente.
//
// El submodal configura UNA variación completa: un valor por eje (Talla: M,
// Color: Negro), su foto y sus datos. "Guardar y crear otra" deja el submodal
// abierto para seguir cargando, que es lo común al dar de alta un producto.
//
// El estado vive en el padre como un arreglo:
//   [{ key, attributes: { Talla: 'M', Color: 'Negro' }, stock, price, cost, sku, file }]
import { useState } from 'react';

export const emptyVariations = () => [];

export const sigOf = (axisNames, attrs) => axisNames.map((a) => attrs[a] ?? '').join('|');

export const labelOf = (axisNames, attrs) => axisNames.map((a) => attrs[a]).filter(Boolean).join(' · ');

const newKey = () => Math.random().toString(36).slice(2);

const TRASH = (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d="M5 7h14M10 7V5h4v2M6 7l1 12a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ---------- Submodal: una variación ----------
function VariationDialog({ axes, taken, onAdd, onClose }) {
  const axisNames = axes.map((a) => a.name);
  const [form, setForm] = useState({ values: {}, stock: '', price: '', cost: '', sku: '', file: null });
  const [extra, setExtra] = useState({});      // eje → valor escrito a mano
  const [error, setError] = useState(null);
  const [added, setAdded] = useState(0);

  const set = (patch) => { setError(null); setForm((f) => ({ ...f, ...patch })); };
  const setValue = (axis, v) => set({ values: { ...form.values, [axis]: v } });

  function build() {
    const attributes = {};
    for (const name of axisNames) {
      const v = (form.values[name] || '').trim();
      if (!v) { setError(`Elige ${name.toLowerCase()}.`); return null; }
      attributes[name] = v;
    }
    const sig = sigOf(axisNames, attributes);
    if (taken.has(sig)) { setError(`${labelOf(axisNames, attributes)} ya está en la lista.`); return null; }
    return {
      key: newKey(), attributes, stock: form.stock, price: form.price,
      cost: form.cost, sku: form.sku.trim(), file: form.file,
    };
  }

  function submit(another) {
    setError(null);
    const row = build();
    if (!row) return;
    onAdd(row);
    if (another) {
      // Se conservan precio y costo (suelen repetirse) y se limpia lo demás.
      setForm((f) => ({ ...f, values: {}, stock: '', sku: '', file: null }));
      setAdded((n) => n + 1);
    } else {
      onClose();
    }
  }

  return (
    <div className="modal-backdrop stacked" onClick={onClose}>
      <div className="modal card vd-modal" role="dialog" aria-modal="true" aria-labelledby="vd-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') e.preventDefault(); }}>
        <div className="modal-head">
          <h2 id="vd-title">Nueva variación</h2>
          <button type="button" className="btn ghost sm" onClick={onClose}>Cerrar</button>
        </div>

        {axes.map((axis) => {
          const names = axis.terms.map((t) => t.name);
          const chosen = form.values[axis.name] || '';
          return (
            <div className="vd-axis" key={axis.name}>
              <div className="axis-name">{axis.name}</div>
              <div className="chip-row">
                {names.map((v) => (
                  <button type="button" key={v} className={`chip${chosen === v ? ' on' : ''}`}
                    aria-pressed={chosen === v} onClick={() => setValue(axis.name, v)}>{v}</button>
                ))}
                {chosen && !names.includes(chosen) && (
                  <button type="button" className="chip on" aria-pressed="true"
                    onClick={() => setValue(axis.name, '')}>{chosen}</button>
                )}
                <span className="chip-add">
                  <input value={extra[axis.name] || ''} placeholder={`Otro ${axis.name.toLowerCase()}…`}
                    onChange={(e) => setExtra((x) => ({ ...x, [axis.name]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      const v = (extra[axis.name] || '').trim();
                      if (v) { setValue(axis.name, v); setExtra((x) => ({ ...x, [axis.name]: '' })); }
                    }} />
                  <button type="button" className="btn ghost sm" disabled={!(extra[axis.name] || '').trim()}
                    onClick={() => {
                      const v = (extra[axis.name] || '').trim();
                      setValue(axis.name, v); setExtra((x) => ({ ...x, [axis.name]: '' }));
                    }}>Usar</button>
                </span>
              </div>
            </div>
          );
        })}

        <div className="vd-data">
          <label className="vd-photo-slot">
            <span className="vd-photo">
              {form.file ? <img src={URL.createObjectURL(form.file)} alt="" /> : <span className="thumb-ph">＋</span>}
            </span>
            <span className="vd-photo-text">{form.file ? 'Cambiar foto' : 'Foto de esta variación'}</span>
            <input type="file" accept="image/*" hidden
              onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) set({ file: f }); }} />
          </label>
          <div className="vd-fields">
            <label className="vb-field">Cantidad
              <input type="number" min="0" step="1" placeholder="0" autoFocus={axes.length === 0}
                value={form.stock} onChange={(e) => set({ stock: e.target.value })} />
            </label>
            <label className="vb-field">Precio
              <input type="number" min="0" step="0.01" placeholder="hereda"
                value={form.price} onChange={(e) => set({ price: e.target.value })} />
            </label>
            <label className="vb-field">Costo
              <input type="number" min="0" step="0.01" placeholder="hereda"
                value={form.cost} onChange={(e) => set({ cost: e.target.value })} />
            </label>
            <label className="vb-field">SKU
              <input placeholder="opcional" value={form.sku} onChange={(e) => set({ sku: e.target.value })} />
            </label>
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}
        {added > 0 && <p className="hint">{added} {added === 1 ? 'variación agregada' : 'variaciones agregadas'}.</p>}

        <div className="inline-form-actions vd-actions">
          <button type="button" className="btn primary" onClick={() => submit(false)}>Agregar</button>
          <button type="button" className="btn ghost" onClick={() => submit(true)}>Agregar y crear otra</button>
          <button type="button" className="linklike" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Lista de variaciones + botón para agregar ----------
export default function VariantBuilder({
  axes, rows, onChange, existingSigs = new Set(), disabled = false, addLabel = '＋ Agregar variación',
}) {
  const axisNames = axes.map((a) => a.name);
  const [open, setOpen] = useState(false);
  const [bulk, setBulk] = useState({ stock: '', price: '' });

  const taken = new Set([...existingSigs, ...rows.map((r) => sigOf(axisNames, r.attributes))]);
  const patch = (key, p) => onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));

  function applyBulk() {
    onChange(rows.map((r) => ({
      ...r,
      stock: bulk.stock !== '' ? bulk.stock : r.stock,
      price: bulk.price !== '' ? bulk.price : r.price,
    })));
    setBulk({ stock: '', price: '' });
  }

  return (
    <div className="vb">
      {rows.length === 0 ? (
        <p className="hint">Aún no has agregado variaciones. Usa <strong>{addLabel}</strong> para armar la primera.</p>
      ) : (
        <>
          {rows.length > 1 && (
            <div className="vb-bar">
              <strong>{rows.length} {rows.length === 1 ? 'variación' : 'variaciones'}</strong>
              <span className="vb-bar-gap" />
              <span className="muted">Para todas:</span>
              <input type="number" min="0" step="1" placeholder="cantidad" className="vb-bulk"
                value={bulk.stock} onChange={(e) => setBulk((b) => ({ ...b, stock: e.target.value }))} />
              <input type="number" min="0" step="0.01" placeholder="precio" className="vb-bulk"
                value={bulk.price} onChange={(e) => setBulk((b) => ({ ...b, price: e.target.value }))} />
              <button type="button" className="btn ghost sm"
                disabled={disabled || (bulk.stock === '' && bulk.price === '')}
                onClick={applyBulk}>Aplicar</button>
            </div>
          )}

          <div className="vb-list">
            {rows.map((r) => (
              <div className="vb-card" key={r.key}>
                <label className="vb-photo" title={`Foto de ${labelOf(axisNames, r.attributes)}`}>
                  {r.file ? <img src={URL.createObjectURL(r.file)} alt="" /> : <span className="thumb-ph">＋</span>}
                  <input type="file" accept="image/*" hidden disabled={disabled}
                    onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) patch(r.key, { file: f }); }} />
                </label>
                <div className="vb-card-body">
                  <div className="vb-card-head">
                    <span className="vb-label">{labelOf(axisNames, r.attributes)}</span>
                    {r.file && (
                      <button type="button" className="linklike" onClick={() => patch(r.key, { file: null })}>quitar foto</button>
                    )}
                    <button type="button" className="vb-del" title="Quitar esta variación"
                      aria-label={`Quitar ${labelOf(axisNames, r.attributes)}`}
                      onClick={() => onChange(rows.filter((x) => x.key !== r.key))}>{TRASH}</button>
                  </div>
                  <div className="vb-fields">
                    <label className="vb-field">Cantidad
                      <input type="number" min="0" step="1" placeholder="0" disabled={disabled}
                        value={r.stock} onChange={(e) => patch(r.key, { stock: e.target.value })} />
                    </label>
                    <label className="vb-field">Precio
                      <input type="number" min="0" step="0.01" placeholder="hereda" disabled={disabled}
                        value={r.price} onChange={(e) => patch(r.key, { price: e.target.value })} />
                    </label>
                    <label className="vb-field">Costo
                      <input type="number" min="0" step="0.01" placeholder="hereda" disabled={disabled}
                        value={r.cost} onChange={(e) => patch(r.key, { cost: e.target.value })} />
                    </label>
                    <label className="vb-field">SKU
                      <input placeholder="opcional" disabled={disabled}
                        value={r.sku} onChange={(e) => patch(r.key, { sku: e.target.value })} />
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <button type="button" className="btn ghost vb-add" disabled={disabled || axes.length === 0}
        onClick={() => setOpen(true)}>{addLabel}</button>

      {open && (
        <VariationDialog axes={axes} taken={taken}
          onAdd={(row) => onChange([...rows, row])}
          onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
