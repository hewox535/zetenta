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

// Desplegable con los valores del eje (Talla: S, M, L…) y "＋ Otro…" para
// escribir uno que no esté en la lista.
function ValueSelect({ axis, value, onChange }) {
  const names = axis.terms.map((t) => t.name);
  const [custom, setCustom] = useState(() => !!value && !names.includes(value));

  if (custom) {
    return (
      <span className="term-select">
        <input autoFocus value={value} placeholder={`Nuevo ${axis.name.toLowerCase()}`}
          onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="term-select-back" title="Elegir de la lista"
          onClick={() => { setCustom(false); onChange(''); }}>▾</button>
      </span>
    );
  }
  return (
    <select value={names.includes(value) ? value : ''}
      onChange={(e) => {
        if (e.target.value === '__new__') { setCustom(true); onChange(''); }
        else onChange(e.target.value);
      }}>
      <option value="">Elegir {axis.name.toLowerCase()}…</option>
      {names.map((n) => <option key={n} value={n}>{n}</option>)}
      <option value="__new__">＋ Otro…</option>
    </select>
  );
}

// Desplegable de ejes disponibles, con "＋ Otro…" para uno que el negocio
// todavía no tiene (Material, Sabor…).
function AxisSelect({ options, value, onChange }) {
  const [custom, setCustom] = useState(() => !!value && !options.includes(value));
  if (custom) {
    return (
      <span className="term-select">
        <input autoFocus value={value} placeholder="Nombre del eje (Material…)"
          onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="term-select-back" title="Elegir de la lista"
          onClick={() => { setCustom(false); onChange(''); }}>▾</button>
      </span>
    );
  }
  return (
    <select value={options.includes(value) ? value : ''}
      onChange={(e) => {
        if (e.target.value === '__new__') { setCustom(true); onChange(''); }
        else onChange(e.target.value);
      }}>
      <option value="">Elegir eje…</option>
      {options.map((n) => <option key={n} value={n}>{n}</option>)}
      <option value="__new__">＋ Otro…</option>
    </select>
  );
}

// ---------- Submodal: una variación ----------
// `initial` llega al editar una variación que ya existe; entonces el diálogo
// guarda los cambios en vez de agregar a la lista.
export function VariationDialog({
  axes, taken, onAdd, onClose, initial = null, title,
  availableAxes = [], onAddAxis = null, othersCount = 0, busy = false,
}) {
  const axisNames = axes.map((a) => a.name);
  const editing = !!initial;
  // Eje que se está sumando al producto desde aquí: { name, value }
  const [newAxis, setNewAxis] = useState(null);
  const [form, setForm] = useState({
    values: initial?.values || {}, stock: initial?.stock ?? '', price: initial?.price ?? '',
    cost: initial?.cost ?? '', sku: initial?.sku ?? '', file: null,
  });
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
      key: initial?.key || newKey(), attributes, stock: form.stock, price: form.price,
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
          <h2 id="vd-title">{title || (editing ? 'Editar variación' : 'Nueva variación')}</h2>
          <button type="button" className="btn ghost sm" onClick={onClose}>Cerrar</button>
        </div>

        <div className="vd-axes">
          {axes.map((axis) => (
            <label className="vb-field" key={axis.name}>{axis.name}
              <ValueSelect axis={axis} value={form.values[axis.name] || ''}
                onChange={(v) => setValue(axis.name, v)} />
            </label>
          ))}
        </div>

        {axes.length === 0 && !newAxis && (
          <p className="hint">
            Este producto todavía no varía por nada. Agrega un eje (talla, color…) para empezar.
          </p>
        )}

        {onAddAxis && (newAxis ? (
          <div className="vd-newaxis">
            <div className="vd-axes">
              <label className="vb-field">¿En qué más varía?
                <AxisSelect options={availableAxes.map((a) => a.name)} value={newAxis.name}
                  onChange={(name) => setNewAxis({ name, value: '' })} />
              </label>
              {newAxis.name && othersCount > 0 && (
                <label className="vb-field">
                  {othersCount === 1
                    ? `¿Qué ${newAxis.name.toLowerCase()} lleva la otra variación?`
                    : `¿Qué ${newAxis.name.toLowerCase()} llevan las otras ${othersCount}?`}
                  <ValueSelect
                    axis={availableAxes.find((a) => a.name === newAxis.name) || { name: newAxis.name, terms: [] }}
                    value={newAxis.value} onChange={(value) => setNewAxis((a) => ({ ...a, value }))} />
                </label>
              )}
            </div>
            <div className="vd-newaxis-actions">
              <button type="button" className="btn ghost sm"
                disabled={busy || !newAxis.name.trim() || (othersCount > 0 && !newAxis.value.trim())}
                onClick={async () => {
                  setError(null);
                  try {
                    const axis = newAxis.name.trim();
                    const val = newAxis.value.trim();
                    await onAddAxis(axis, val);
                    // Esta variación arranca con el mismo valor que las demás;
                    // el usuario lo cambia si esta es la distinta.
                    if (val) setValue(axis, val);
                    setNewAxis(null);
                  } catch (e) { setError(e.message); }
                }}>Agregar eje</button>
              <button type="button" className="linklike" onClick={() => setNewAxis(null)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button type="button" className="linklike vd-addaxis" disabled={busy}
            onClick={() => setNewAxis({ name: '', value: '' })}>
            ＋ {axes.length === 0 ? 'Agregar eje (talla, color…)' : 'Agregar otro eje (color, material…)'}
          </button>
        ))}

        <div className="vd-data">
          {!editing && (
          <label className="vd-photo-slot">
            <span className="vd-photo">
              {form.file ? <img src={URL.createObjectURL(form.file)} alt="" /> : <span className="thumb-ph">＋</span>}
            </span>
            <span className="vd-photo-text">{form.file ? 'Cambiar foto' : 'Foto de esta variación'}</span>
            <input type="file" accept="image/*" hidden
              onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) set({ file: f }); }} />
          </label>
          )}
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
          <button type="button" className="btn primary" onClick={() => submit(false)}>
            {editing ? 'Guardar cambios' : 'Agregar'}
          </button>
          {!editing && (
            <button type="button" className="btn ghost" onClick={() => submit(true)}>Agregar y crear otra</button>
          )}
          <button type="button" className="linklike" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Lista de variaciones + botón para agregar ----------
export default function VariantBuilder({
  axes, rows, onChange, existingSigs = new Set(), disabled = false, addLabel = '＋ Agregar variación',
  availableAxes = [], onAddAxis = null, othersCount = 0,
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

      <button type="button" className="btn ghost vb-add" disabled={disabled}
        onClick={() => setOpen(true)}>{addLabel}</button>

      {open && (
        <VariationDialog axes={axes} taken={taken}
          availableAxes={availableAxes} onAddAxis={onAddAxis}
          othersCount={othersCount + rows.length} busy={disabled}
          onAdd={(row) => onChange([...rows, row])}
          onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
