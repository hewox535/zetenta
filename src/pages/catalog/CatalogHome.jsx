import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Link, useNavigationType, useOutletContext } from 'react-router-dom';
import {
  coverImages, priceInfo, fmtPrice, productAxes, axisOptions, isColorAxis, colorHex, isMulticolor,
  saveScroll, takeScroll,
} from './catalogUtils';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function Swatch({ name, size }) {
  const hex = colorHex(name);
  const multi = isMulticolor(name);
  if (!hex && !multi) return null;
  return (
    <span className={`cat-swatch${size ? ` ${size}` : ''}${hex === '#ffffff' ? ' light' : ''}`} title={name}
      style={multi ? { background: 'conic-gradient(#ff5e57, #ffd23f, #3ddc84, #3da5ff, #b061ff, #ff5e57)' } : { background: hex }} />
  );
}

export function ProductCard({ product, href, index = 0, onOpen }) {
  const [img, img2] = coverImages(product);
  const { price, from, base, offer } = priceInfo(product);
  const sold = !product.available;
  const axes = productAxes(product);
  const colorAxis = axes.find(isColorAxis);
  const colors = colorAxis ? axisOptions(product, colorAxis).filter((c) => colorHex(c) || isMulticolor(c)) : [];
  const sizeAxis = axes.find((a) => !isColorAxis(a));
  const sizes = sizeAxis ? axisOptions(product, sizeAxis) : [];

  return (
    <Link to={href(`/catalogo/${product.id}`)} onClick={onOpen} className={`cat-card${sold ? ' sold' : ''}`}
      style={{ '--i': Math.min(index, 12) }}>
      <div className="cat-card-media">
        {img
          ? <>
              <img src={img} alt={product.name} loading="lazy" decoding="async" className="cat-img-main" />
              {img2 && <img src={img2} alt="" loading="lazy" decoding="async" className="cat-img-alt" aria-hidden="true" />}
            </>
          : <div className="cat-noimg" aria-hidden="true">{product.name.trim().charAt(0).toUpperCase()}</div>}
        {offer > 0 && !sold && <span className="cat-badge">−{Math.round(offer)}%</span>}
        {sold && <span className="cat-badge sold">Agotado</span>}
      </div>
      <div className="cat-card-body">
        <h3>{product.name}</h3>
        <div className="cat-price">
          {from && <span className="cat-from">Desde</span>}
          <strong>{fmtPrice(price)}</strong>
          {offer > 0 && <s>{fmtPrice(base)}</s>}
        </div>
        {(colors.length > 1 || sizes.length > 1) && (
          <div className="cat-card-meta">
            {colors.length > 1 && (
              <span className="cat-dots">
                {colors.slice(0, 4).map((c) => <Swatch key={c} name={c} size="xs" />)}
                {colors.length > 4 && <em>+{colors.length - 4}</em>}
              </span>
            )}
            {sizes.length > 1 && <span className="cat-sizes">{sizes.length} tallas</span>}
          </div>
        )}
      </div>
    </Link>
  );
}

export default function CatalogHome() {
  const { store, catalog, href, params, setParam, query } = useOutletContext();
  const navType = useNavigationType();
  const cat = params.get('cat') || '';
  const onlyAvail = params.get('disp') === '1';
  const chipsRef = useRef(null);

  const catNames = useMemo(() => Object.fromEntries(catalog.categories.map((c) => [c.id, c.name])), [catalog]);
  const categories = useMemo(() => {
    const counts = {};
    for (const p of catalog.products) for (const id of p.category_ids) counts[id] = (counts[id] || 0) + 1;
    return catalog.categories.filter((c) => counts[c.id]);
  }, [catalog]);

  const products = useMemo(() => {
    const q = norm(query).trim();
    return catalog.products.filter((p) => {
      if (cat && !p.category_ids.includes(cat)) return false;
      if (onlyAvail && !p.available) return false;
      if (!q) return true;
      const hay = norm([p.name, ...p.category_ids.map((id) => catNames[id]),
        ...p.variants.flatMap((v) => Object.values(v.attributes || {}))].join(' '));
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
  }, [catalog, cat, onlyAvail, query, catNames]);

  // Volver desde un producto: devuelve el scroll; entrar de nuevo: arriba.
  useLayoutEffect(() => {
    window.scrollTo(0, navType === 'POP' ? takeScroll() : 0);
  }, [navType]);

  // La categoría activa siempre queda a la vista en el carrusel.
  useEffect(() => {
    chipsRef.current?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [cat]);

  const filtering = !!(cat || query || onlyAvail);

  return (
    <>
      <section className="cat-hero cat-wrap">
        <h1>Catálogo</h1>
        <p>{catalog.tagline || `Descubre lo último de ${store.name}.`}</p>
      </section>

      {categories.length > 0 && (
        <nav className="cat-chips-bar" aria-label="Categorías">
          <div className="cat-chips" ref={chipsRef} role="tablist">
            <button role="tab" aria-selected={!cat} className={`cat-chip${!cat ? ' on' : ''}`} onClick={() => setParam('cat', '')}>Todo</button>
            {categories.map((c) => (
              <button key={c.id} role="tab" aria-selected={cat === c.id} className={`cat-chip${cat === c.id ? ' on' : ''}`}
                onClick={() => setParam('cat', cat === c.id ? '' : c.id)}>{c.name}</button>
            ))}
          </div>
        </nav>
      )}

      <section className="cat-wrap cat-results">
        <div className="cat-toolbar">
          <span aria-live="polite">{products.length} {products.length === 1 ? 'producto' : 'productos'}</span>
          <button type="button" className={`cat-toggle${onlyAvail ? ' on' : ''}`} role="switch" aria-checked={onlyAvail}
            onClick={() => setParam('disp', onlyAvail ? '' : '1')}>
            <i /> Solo disponibles
          </button>
        </div>

        {products.length === 0 ? (
          <div className="cat-empty">
            <div className="cat-notice-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
            </div>
            <h2>{filtering ? 'Sin resultados' : 'Aún no hay productos'}</h2>
            <p>{query ? `No encontramos nada para “${query}”.` : filtering ? 'Prueba con otra categoría o quita los filtros.' : 'Estamos preparando el catálogo.'}</p>
            {filtering && (
              <button className="cat-btn" onClick={() => setParam({ q: '', cat: '', disp: '' })}>Ver todo</button>
            )}
          </div>
        ) : (
          <div className="cat-grid">
            {products.map((p, i) => <ProductCard key={p.id} product={p} href={href} index={i} onOpen={saveScroll} />)}
          </div>
        )}
      </section>
    </>
  );
}
