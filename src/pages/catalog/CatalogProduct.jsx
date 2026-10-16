import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useOutletContext, useParams } from 'react-router-dom';
import { Icon } from './Catalog';
import { ProductCard, Swatch } from './CatalogHome';
import {
  axisOptions, defaultSelection, findVariant, fmtPrice, galleryImages, isColorAxis, optionAvailable,
  productAxes, selectValue, variantBase, variantPrice, variantText, whatsappLink, colorHex, isMulticolor,
} from './catalogUtils';

function Gallery({ images, name, sold }) {
  const track = useRef(null);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const key = images.map((i) => i.id).join();

  // Cambió el set de fotos (otro color): volver a la primera.
  useEffect(() => {
    track.current?.scrollTo({ left: 0 });
    setIndex(0);
  }, [key]);

  useEffect(() => {
    if (!zoom) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setZoom(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [zoom]);

  function goTo(i) {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  }

  if (!images.length) {
    return (
      <div className="cat-gallery">
        <div className="cat-gal-main"><div className="cat-noimg big" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</div></div>
      </div>
    );
  }

  return (
    <div className="cat-gallery">
      <div className="cat-gal-main">
        <div className={`cat-gal-track${sold ? ' sold' : ''}`} ref={track}
          onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
          {images.map((im, i) => (
            <button key={im.id} type="button" className="cat-gal-slide" onClick={() => setZoom(true)} aria-label="Ampliar foto">
              <img src={im.src} alt={`${name} — foto ${i + 1}`} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" draggable="false" />
            </button>
          ))}
        </div>
        {images.length > 1 && (
          <div className="cat-gal-dots" aria-hidden="true">
            {images.map((im, i) => <i key={im.id} className={i === index ? 'on' : ''} />)}
          </div>
        )}
      </div>
      {images.length > 1 && (
        <div className="cat-thumbs">
          {images.map((im, i) => (
            <button key={im.id} type="button" className={i === index ? 'on' : ''} onClick={() => goTo(i)} aria-label={`Ver foto ${i + 1}`}>
              <img src={im.src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {zoom && (
        <div className="cat-lightbox" onClick={() => setZoom(false)} role="dialog" aria-modal="true" aria-label="Foto ampliada">
          <button type="button" className="cat-lightbox-x" aria-label="Cerrar">{Icon.close}</button>
          <img src={images[index]?.src} alt={name} />
        </div>
      )}
    </div>
  );
}

function Option({ axis, value, selected, available, onPick }) {
  const color = isColorAxis(axis) && (colorHex(value) || isMulticolor(value));
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={`${value}${available ? '' : ' (agotado)'}`}
      className={`cat-opt${color ? ' color' : ''}${selected ? ' on' : ''}${available ? '' : ' out'}`} onClick={onPick}>
      {color ? <Swatch name={value} size="lg" /> : value}
    </button>
  );
}

export default function CatalogProduct() {
  const { id: param } = useParams();
  const { store, catalog, href, goBack } = useOutletContext();
  // La URL lleva el slug del nombre; los enlaces viejos con id siguen sirviendo.
  const product = useMemo(
    () => catalog.products.find((p) => p.slug === param) || catalog.products.find((p) => p.id === param),
    [catalog, param],
  );

  if (!product) {
    return (
      <div className="cat-wrap">
        <div className="cat-notice">
          <div className="cat-notice-icon">{Icon.bag}</div>
          <h1>Producto no disponible</h1>
          <p>Puede que ya no esté en el catálogo.</p>
          <Link className="cat-btn" to={href('/catalogo')}>Ver el catálogo</Link>
        </div>
      </div>
    );
  }
  if (product.slug && param !== product.slug) return <Navigate to={href(`/catalogo/${product.slug}`)} replace />;
  return <ProductView key={product.id} product={product} store={store} catalog={catalog} href={href} goBack={goBack} />;
}

function ProductView({ product, store, catalog, href, goBack }) {
  const axes = useMemo(() => productAxes(product), [product]);
  const [selection, setSelection] = useState(() => defaultSelection(product, axes));
  const [toast, setToast] = useState('');

  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const variant = useMemo(
    () => findVariant(product, selection) || (axes.length ? null : product.variants?.[0]) || null,
    [product, selection, axes],
  );
  const images = useMemo(() => galleryImages(product, variant, axes), [product, variant, axes]);

  const offer = Number(product.offer_percent) > 0 ? Number(product.offer_percent) : 0;
  const price = variantPrice(product, variant);
  const base = variantBase(product, variant);
  const available = variant ? variant.available : product.available;
  const label = variantText(variant, axes);

  const categoryName = useMemo(() => {
    const c = catalog.categories.find((x) => product.category_ids.includes(x.id));
    return c?.name || '';
  }, [catalog, product]);

  const related = useMemo(() => {
    const same = catalog.products.filter((p) => p.id !== product.id && p.category_ids.some((c) => product.category_ids.includes(c)));
    const rest = catalog.products.filter((p) => p.id !== product.id && !same.includes(p));
    return [...same, ...rest].filter((p) => p.available).slice(0, 4);
  }, [catalog, product]);

  const message = `Hola ${store.name}, me interesa “${product.name}”${label ? ` (${label})` : ''} — ${fmtPrice(price)}.\n${window.location.href}`;
  const wa = catalog.whatsapp ? whatsappLink(catalog.whatsapp, message) : null;

  async function share() {
    const data = { title: `${product.name} — ${store.name}`, url: window.location.href };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(data.url);
      setToast('Enlace copiado');
    } catch { /* el cliente canceló el menú de compartir */ }
  }

  const priceBlock = (
    <div className="cat-pdp-price">
      <strong>{fmtPrice(price)}</strong>
      {offer > 0 && <><s>{fmtPrice(base)}</s><span className="cat-badge inline">−{Math.round(offer)}%</span></>}
    </div>
  );
  const cta = wa && (
    <a className={`cat-cta${available ? '' : ' alt'}`} href={wa} target="_blank" rel="noreferrer">
      {Icon.whatsapp}{available ? 'Pedir por WhatsApp' : 'Preguntar por disponibilidad'}
    </a>
  );

  return (
    <div className="cat-wrap cat-pdp-wrap">
      <button type="button" className="cat-back" onClick={goBack}>{Icon.back}<span>Catálogo</span></button>

      <div className="cat-pdp">
        <Gallery images={images} name={product.name} sold={!available} />

        <div className="cat-info">
          {categoryName && <span className="cat-eyebrow">{categoryName}</span>}
          <div className="cat-title-row">
            <h1>{product.name}</h1>
            <button type="button" className="cat-icon-btn" onClick={share} aria-label="Compartir">{Icon.share}</button>
          </div>
          {priceBlock}
          <div className={`cat-avail ${available ? 'ok' : 'out'}`} role="status">
            <i />{available ? 'Disponible' : 'Agotado'}{label && axes.length > 0 && <span> · {label}</span>}
          </div>

          {axes.map((axis) => (
            <div className="cat-axis" key={axis} role="radiogroup" aria-label={axis}>
              <div className="cat-axis-head"><span>{axis}</span><strong>{selection[axis]}</strong></div>
              <div className="cat-opts">
                {axisOptions(product, axis).map((val) => (
                  <Option key={val} axis={axis} value={val} selected={selection[axis] === val}
                    available={optionAvailable(product, axes, selection, axis, val)}
                    onPick={() => setSelection(selectValue(product, axes, selection, axis, val))} />
                ))}
              </div>
            </div>
          ))}

          <div className="cat-cta-inline">{cta}</div>
          {!wa && !available && <p className="cat-hint">Este artículo está agotado por ahora.</p>}
        </div>
      </div>

      {related.length > 0 && (
        <section className="cat-related">
          <h2>También te puede gustar</h2>
          <div className="cat-grid">
            {related.map((p, i) => <ProductCard key={p.id} product={p} href={href} index={i} />)}
          </div>
        </section>
      )}

      {wa && (
        <div className="cat-sticky">
          <div className="cat-sticky-price">
            <strong>{fmtPrice(price)}</strong>
            {offer > 0 && <s>{fmtPrice(base)}</s>}
          </div>
          {cta}
        </div>
      )}
      <div className={`cat-toast${toast ? ' show' : ''}`} role="status">{toast}</div>
    </div>
  );
}
