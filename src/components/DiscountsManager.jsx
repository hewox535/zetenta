// Descuentos especiales (Negocio → Ventas): Black Friday, liquidaciones…
// Cada uno dice a qué aplica (categorías/marcas, productos elegidos o toda la
// tienda), cuánto si se paga de contado y cuánto con Cashea, y entre qué
// fechas. El POS los aplica solo; no son cupones.
import { useEffect, useMemo, useState } from 'react';
import { FinModal } from './FinUI';
import { useConfirm } from './Confirm';
import { fetchDiscounts, saveDiscount, deleteDiscount, fetchProducts, fetchTaxonomies } from '../lib/api';
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
  const [taxonomies, setTaxonomies] = useState([]);
  const [products, setProducts] = useState(null);
  const [editing, setEditing] = useState(null);   // descuento (o {} si es nuevo)
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchDiscounts().then(setList).catch((e) => { setList([]); setError(e.message); });
    fetchTaxonomies().then(setTaxonomies).catch(() => {});
  }, []);
  // Los productos se cargan al abrir el editor (son muchos).
  useEffect(() => {
    if (editing && !products) fetchProducts().then(setProducts).catch(() => setProducts([]));
  }, [editing, products]);

  const termName = useMemo(() => {
    const m = new Map();
    taxonomies.forEach((t) => (t.taxonomy_terms || []).forEach((x) => m.set(x.id, x.name)));
    return m;
  }, [taxonomies]);

  const scopeText = (ds) => {
    if (ds.scope === 'all') return 'Toda la tienda';
    if (ds.scope === 'products') {
      const n = (ds.product_ids || []).length;
      return n === 1 ? '1 producto elegido' : `${n} productos elegidos`;
    }
    const names = (ds.term_ids || []).map((id) => termName.get(id)).filter(Boolean);
    return names.length ? names.join(', ') : 'Sin categoría';
  };

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
            Para temporadas como Black Friday. Se aplican solos al cobrar los productos que califican,
            según se pague de contado o con Cashea. No se suman: en cada producto gana el mayor.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={() => setEditing({})}>+ Nuevo descuento</button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {list && list.length === 0 && (
        <button type="button" className="ds-empty" onClick={() => setEditing({})}>
          <strong>Aún no hay descuentos</strong>
          <span>Ej.: «Black Friday · Ropa»: 40% de contado y 20% con Cashea en la ropa que elijas.</span>
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
                  <span className="ds-sub">{scopeText(ds)} · {rangeText(ds)}</span>
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
        <DiscountEditor business={business} initial={editing} taxonomies={taxonomies} products={products}
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

const SCOPES = [
  { key: 'terms', label: 'Categorías' },
  { key: 'products', label: 'Productos' },
  { key: 'all', label: 'Toda la tienda' },
];

function DiscountEditor({ business, initial, taxonomies, products, onClose, onSaved, onDelete }) {
  const [name, setName] = useState(initial.name || '');
  const [scope, setScope] = useState(initial.scope || 'terms');
  const [terms, setTerms] = useState(() => new Set(initial.term_ids || []));
  const [picked, setPicked] = useState(() => new Set(initial.product_ids || []));
  const [cash, setCash] = useState(initial.cash_percent != null ? String(Number(initial.cash_percent)) : '');
  const [cashea, setCashea] = useState(initial.cashea_percent != null ? String(Number(initial.cashea_percent)) : '');
  const [from, setFrom] = useState(initial.starts_on || '');
  const [to, setTo] = useState(initial.ends_on || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [onlyPicked, setOnlyPicked] = useState(false);

  // Solo las clasificaciones (categoría, marca…), no tallas ni colores.
  const groups = taxonomies.filter((t) => t.kind !== 'variant' && (t.taxonomy_terms || []).length);
  const termCount = useMemo(() => {
    const m = new Map();
    (products || []).forEach((p) => (p.product_terms || []).forEach((pt) => m.set(pt.term_id, (m.get(pt.term_id) || 0) + 1)));
    return m;
  }, [products]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (products || []).filter((p) => {
      if (onlyPicked && !picked.has(p.id)) return false;
      if (cat && !(p.product_terms || []).some((pt) => pt.term_id === cat)) return false;
      return !s || p.name.toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s);
    });
  }, [products, q, cat, onlyPicked, picked]);
  const allShownPicked = shown.length > 0 && shown.every((p) => picked.has(p.id));

  const covered = useMemo(() => {
    if (!products) return null;
    if (scope === 'all') return products.length;
    if (scope === 'products') return picked.size;
    return products.filter((p) => (p.product_terms || []).some((pt) => terms.has(pt.term_id))).length;
  }, [products, scope, picked, terms]);

  const num = (v) => (String(v).trim() === '' ? null : Number(String(v).replace(',', '.')));
  const cashN = num(cash); const casheaN = num(cashea);
  const pctOk = (n) => n === null || (Number.isFinite(n) && n >= 0 && n < 100);

  const toggleIn = (set, setter, id) => setter(() => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickShown = () => setPicked((prev) => {
    const n = new Set(prev);
    shown.forEach((p) => (allShownPicked ? n.delete(p.id) : n.add(p.id)));
    return n;
  });

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return setError('Ponle un nombre, p. ej. «Black Friday · Ropa».');
    if (!pctOk(cashN) || !pctOk(casheaN)) return setError('Los porcentajes van de 0 a 99.');
    if (!(cashN > 0) && !(casheaN > 0)) return setError('Escribe el % de contado, el de Cashea o ambos.');
    if (scope === 'terms' && !terms.size) return setError('Elige al menos una categoría o marca.');
    if (scope === 'products' && !picked.size) return setError('Elige al menos un producto.');
    if (from && to && to < from) return setError('La fecha de fin es anterior a la de inicio.');
    setBusy(true); setError(null);
    try {
      const row = await saveDiscount(business.id, {
        id: initial.id, name: name.trim(), scope,
        term_ids: scope === 'terms' ? [...terms] : [],
        product_ids: scope === 'products' ? [...picked] : [],
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
      sub="Se aplica solo en el punto de venta a los productos que califican."
      footer={(
        <>
          {onDelete && <button type="button" className="btn ghost danger ds-del" disabled={busy} onClick={onDelete}>Eliminar</button>}
          <span className="ds-cover">
            {covered == null ? '' : covered === 1 ? <><strong>1 producto</strong> con descuento</> : <><strong>{covered} productos</strong> con descuento</>}
          </span>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <label className="ds-field">
        <span className="ds-label">Nombre</span>
        <input value={name} onChange={(e) => { setName(e.target.value); setError(null); }}
          placeholder="Black Friday · Ropa" maxLength={60} autoFocus={!initial.id} />
        <span className="field-hint">Así lo verá la vendedora al cobrar.</span>
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
        <span className="ds-label">Aplica a</span>
        <div className="ds-seg" role="radiogroup" aria-label="Aplica a">
          {SCOPES.map((s) => (
            <button key={s.key} type="button" role="radio" aria-checked={scope === s.key}
              className={`ds-seg-btn${scope === s.key ? ' on' : ''}`} onClick={() => { setScope(s.key); setError(null); }}>
              {s.label}
            </button>
          ))}
        </div>

        {scope === 'terms' && (
          <div className="ds-terms">
            {groups.length === 0 && <p className="hint">No hay categorías. Créalas en Negocio → Catálogo.</p>}
            {groups.map((t) => (
              <div className="ds-term-group" key={t.id}>
                <span className="ds-term-tax">{t.name}</span>
                <div className="ds-chips">
                  {t.taxonomy_terms.slice().sort((a, b) => a.name.localeCompare(b.name)).map((x) => (
                    <button type="button" key={x.id} aria-pressed={terms.has(x.id)}
                      className={`ds-chip${terms.has(x.id) ? ' on' : ''}`}
                      onClick={() => { toggleIn(terms, setTerms, x.id); setError(null); }}>
                      {x.name}{products && <span className="ds-chip-n">{termCount.get(x.id) || 0}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {scope === 'products' && (
          <div className="ds-picker">
            <div className="ds-picker-bar">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto o código" />
              <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filtrar por categoría">
                <option value="">Todas</option>
                {groups.map((t) => (
                  <optgroup key={t.id} label={t.name}>
                    {t.taxonomy_terms.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="ds-picker-tools">
              <button type="button" className="ds-link" disabled={!shown.length} onClick={pickShown}>
                {allShownPicked ? 'Quitar' : 'Marcar'} {q || cat ? `los ${shown.length} filtrados` : `los ${shown.length}`}
              </button>
              <button type="button" className={`ds-link${onlyPicked ? ' on' : ''}`} onClick={() => setOnlyPicked((v) => !v)}>
                {onlyPicked ? 'Ver todos' : `Ver elegidos (${picked.size})`}
              </button>
            </div>
            <div className="ds-picker-list">
              {!products && <div className="ds-picker-empty">Cargando productos…</div>}
              {products && shown.length === 0 && <div className="ds-picker-empty">Ningún producto coincide.</div>}
              {shown.slice(0, 300).map((p) => (
                <label className={`ds-prod${picked.has(p.id) ? ' on' : ''}`} key={p.id}>
                  <input type="checkbox" checked={picked.has(p.id)} onChange={() => { toggleIn(picked, setPicked, p.id); setError(null); }} />
                  <span className="ds-prod-name">{p.name}{p.sku && <small>{p.sku}</small>}</span>
                  <span className="ds-prod-price">{usd(p.price)}</span>
                </label>
              ))}
              {shown.length > 300 && <div className="ds-picker-empty">Busca para ver más ({shown.length - 300}).</div>}
            </div>
          </div>
        )}

        {scope === 'all' && <p className="hint">Todos los productos de la tienda, incluidos los que agregues después.</p>}
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
