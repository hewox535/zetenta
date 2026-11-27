import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAuditLog } from '../lib/api';
import { norm } from '../lib/finance';
import { AREAS, CHANGE_TYPES, actionText, changeLines, initialsOf, typesOf } from '../lib/audit';
import './changelog.css';

const PAGE = 150;
const dayKey = (iso) => new Date(iso).toDateString();
function dayLabel(iso) {
  const d = new Date(iso); const t = new Date();
  const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Hoy';
  if (d.toDateString() === y.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}
// En variaciones, disponibilidad y fotos la etiqueta es "Producto · detalle";
// en lo demás (p. ej. el descuento "Black Friday · Ropa") el nombre va entero.
const SPLIT = new Set(['product_variants', 'variant_stock', 'product_media']);
const titleOf = (e) => (e.entity === 'businesses' ? 'Configuración del negocio' : SPLIT.has(e.entity) ? e.label.split(' · ')[0] : e.label);
const subOf = (e) => (SPLIT.has(e.entity) && e.label.includes(' · ') ? e.label.split(' · ').slice(1).join(' · ') : '');
const timeOf = (iso) => new Date(iso).toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit' });

// Agrupa cambios seguidos de la misma persona sobre lo mismo (producto o
// registro) hechos con menos de 2 minutos de diferencia: una edición = una tarjeta.
function groupEntries(list) {
  const out = [];
  for (const e of list) {
    const key = `${e.actor_id || 'sys'}|${e.product_id || e.entity + e.entity_id}`;
    const last = out[out.length - 1];
    if (last && last.key === key && Math.abs(new Date(last.items[last.items.length - 1].created_at) - new Date(e.created_at)) < 120000) {
      last.items.push(e);
    } else {
      out.push({ key, items: [e] });
    }
  }
  return out;
}

// Historial de cambios. mode 'products': filtros por tipo de cambio (Inventario).
// mode 'activity': filtros por área (Negocio → Actividad). productId: solo ese producto.
export default function ChangeLog({ mode = 'activity', productId = null, productName = '', onClearProduct }) {
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');    // tipo (products) o área (activity)
  const [actor, setActor] = useState('');
  const [query, setQuery] = useState('');

  const areas = mode === 'products' ? ['productos'] : (filter === 'all' ? null : [filter]);
  const areasKey = (areas || []).join(',');

  const load = useCallback(async (beforeId) => {
    const list = await fetchAuditLog({ areas: areasKey ? areasKey.split(',') : null, productId, beforeId, limit: PAGE });
    setMore(list.length === PAGE);
    return list;
  }, [areasKey, productId]);

  useEffect(() => {
    setRows(null); setError(null);
    load().then(setRows).catch((e) => setError(e.message));
  }, [load]);

  async function loadMore() {
    if (!rows?.length) return;
    setLoadingMore(true);
    try { const next = await load(rows[rows.length - 1].id); setRows((r) => [...r, ...next]); }
    catch (e) { setError(e.message); } finally { setLoadingMore(false); }
  }

  const actors = useMemo(() => {
    const m = new Map();
    (rows || []).forEach((e) => m.set(e.actor_id || 'sys', e.actor_name || 'Sistema'));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const q = norm(query.trim());
  const visible = useMemo(() => (rows || []).filter((e) => {
    if (mode === 'products' && filter !== 'all' && !typesOf(e).has(filter)) return false;
    if (actor && (e.actor_id || 'sys') !== actor) return false;
    if (q && !norm(`${e.label} ${e.actor_name}`).includes(q)) return false;
    return true;
  }), [rows, mode, filter, actor, q]);
  const groups = useMemo(() => groupEntries(visible), [visible]);

  const chips = mode === 'products' ? CHANGE_TYPES : AREAS;
  let lastDay = null;

  return (
    <div className="cl">
      <div className="cl-filters">
        {productId ? (
          <div className="cl-product">
            <span>Cambios de <b>{productName || 'este producto'}</b></span>
            {onClearProduct && <button type="button" className="cl-clear" onClick={onClearProduct}>Ver todos los productos</button>}
          </div>
        ) : (
          <div className="cl-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === 'products' ? 'Buscar producto o persona' : 'Buscar en la actividad'} aria-label="Buscar" />
          </div>
        )}
        {actors.length > 1 && (
          <select className="cl-actor" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Persona">
            <option value="">Todas las personas</option>
            {actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
      </div>
      <div className="cl-chips" role="group" aria-label={mode === 'products' ? 'Tipo de cambio' : 'Área'}>
        {chips.map(([k, l]) => (
          <button key={k} type="button" className={`chip${filter === k ? ' on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}

      {rows === null ? (
        <div className="cl-empty"><span className="muted">Cargando…</span></div>
      ) : groups.length === 0 ? (
        <div className="cl-empty">
          <div className="cl-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 8v4l2.5 2.5" /><circle cx="12" cy="12" r="8" /></svg>
          </div>
          <p className="cl-empty-title">{rows.length === 0 ? 'Aún no hay cambios registrados' : 'Nada coincide con el filtro'}</p>
          <p className="muted">
            {rows.length === 0
              ? 'Desde ahora, cada cambio de precios, datos y configuración queda aquí con quién lo hizo y cuándo.'
              : 'Prueba con otro tipo de cambio, otra persona u otra búsqueda.'}
          </p>
        </div>
      ) : (
        <ol className="cl-list">
          {groups.map((g) => {
            const first = g.items[0];
            const showDay = dayKey(first.created_at) !== lastDay;
            lastDay = dayKey(first.created_at);
            const title = titleOf(g.items.find((e) => !SPLIT.has(e.entity)) || first);
            return (
              <li key={first.id} className="cl-item">
                {showDay && <div className="cl-day">{dayLabel(first.created_at)}</div>}
                <article className="cl-card">
                  <span className="cl-avatar" aria-hidden="true">{initialsOf(first.actor_name)}</span>
                  <div className="cl-body">
                    <header className="cl-head">
                      <strong className="cl-title">{title}</strong>
                      <span className="cl-meta">{first.actor_name || 'Sistema'} · {timeOf(first.created_at)}</span>
                    </header>
                    <ul className="cl-changes">
                      {g.items.map((e) => {
                        const sub = subOf(e);
                        const lines = changeLines(e);
                        const tone = e.action === 'insert' ? 'add' : e.action === 'delete' ? 'del' : '';
                        // Una edición simple no necesita la palabra "Editó": las líneas lo dicen.
                        const showAction = !(e.action === 'update' && e.entity !== 'product_terms' && e.entity !== 'variant_stock' && !sub && lines.length);
                        return (
                          <li key={e.id} className="cl-change">
                            {showAction && <span className={`cl-action ${tone}`}>{actionText(e)}{sub && <em> · {sub}</em>}</span>}
                            {lines.length > 0 && (
                              <span className="cl-lines">
                                {lines.map((l) => (
                                  <span className="cl-line" key={l.field}>
                                    <span className="cl-field">{l.label}</span>
                                    {l.from !== null && (l.from === '—' ? <span className="cl-none">—</span> : <s className="cl-from">{l.from}</s>)}
                                    {l.from !== null && l.to !== null && <span className="cl-arrow" aria-label="cambió a">→</span>}
                                    {l.to !== null && <b className="cl-to">{l.to}</b>}
                                  </span>
                                ))}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}
      {more && rows?.length > 0 && (
        <div className="cl-more">
          <button type="button" className="btn ghost" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}
    </div>
  );
}
