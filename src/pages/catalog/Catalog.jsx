import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useBranding } from '../../context/BrandingContext';
import { fetchBrandBySlug } from '../../lib/api';
import { getCached, loadCatalog, onAccent, whatsappLink } from './catalogUtils';
import './catalog.css';

export const Icon = {
  search: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  close: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>,
  back: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  share: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M6 12v6.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  whatsapp: <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.04 2a9.9 9.9 0 0 0-8.5 14.9L2 22l5.25-1.38A9.9 9.9 0 1 0 12.04 2zm0 1.8a8.1 8.1 0 0 1 0 16.2 8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.1.82.83-3.02-.2-.31A8.1 8.1 0 0 1 12.04 3.8zM8.6 7.6c-.17 0-.45.06-.69.32-.23.26-.9.88-.9 2.15s.92 2.5 1.05 2.67c.13.17 1.8 2.87 4.46 3.9 2.2.87 2.66.7 3.14.65.48-.04 1.55-.63 1.77-1.24.22-.6.22-1.13.15-1.24-.06-.1-.23-.17-.49-.3-.26-.13-1.55-.77-1.79-.85-.24-.09-.41-.13-.58.13-.17.26-.67.85-.82 1.02-.15.17-.3.2-.56.07-.26-.13-1.1-.4-2.09-1.29-.77-.69-1.3-1.54-1.45-1.8-.15-.26-.02-.4.11-.53.12-.12.26-.3.39-.45.13-.15.17-.26.26-.43.09-.17.04-.32-.02-.45-.07-.13-.58-1.4-.8-1.92-.2-.5-.42-.43-.58-.44z"/></svg>,
  bag: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8z M9 8V6.5a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round"/></svg>,
};

function Skeleton() {
  return (
    <div className="cat-wrap" aria-busy="true" aria-label="Cargando catálogo">
      <div className="cat-skel cat-skel-title" />
      <div className="cat-chips-skel">{[70, 90, 80, 100, 75].map((w, i) => <div key={i} className="cat-skel" style={{ width: w }} />)}</div>
      <div className="cat-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="cat-card-skel">
            <div className="cat-skel cat-skel-img" />
            <div className="cat-skel cat-skel-line" />
            <div className="cat-skel cat-skel-line short" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Notice({ title, text, children }) {
  return (
    <div className="cat-wrap">
      <div className="cat-notice">
        <div className="cat-notice-icon">{Icon.bag}</div>
        <h1>{title}</h1>
        <p>{text}</p>
        {children}
      </div>
    </div>
  );
}

// Contenedor público del catálogo del negocio del dominio. Vive fuera del
// área autenticada: cualquiera con el enlace lo ve, con la marca del negocio
// (nombre, logo, color). En el dominio de la plataforma, `?tienda=slug` permite
// verlo sin dominio propio.
export default function Catalog() {
  const brand = useBranding();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tienda = brand.businessId ? null : params.get('tienda');

  // Marca resuelta por slug (solo cuando el host no trae negocio propio)
  const [alt, setAlt] = useState(null);
  const [altDone, setAltDone] = useState(false);
  useEffect(() => {
    if (!tienda) return;
    let active = true;
    fetchBrandBySlug(tienda)
      .then((b) => { if (active) setAlt(b); })
      .catch(() => {})
      .finally(() => { if (active) setAltDone(true); });
    return () => { active = false; };
  }, [tienda]);

  const store = useMemo(() => {
    if (brand.businessId) {
      return { id: brand.businessId, name: brand.name, logoUrl: brand.logoUrl, accent: brand.accent, accent2: brand.accent2 };
    }
    if (alt) return { id: alt.business_id, name: alt.name, logoUrl: alt.logo_url, accent: alt.accent, accent2: alt.accent2 };
    return null;
  }, [brand, alt]);

  const [catalog, setCatalog] = useState(() => (store ? getCached(store.id) : null));
  const [status, setStatus] = useState(catalog ? 'ready' : 'loading');

  const storeId = store?.id;
  const load = useCallback(() => {
    if (!storeId) return;
    loadCatalog(storeId)
      .then((data) => { setCatalog(data); setStatus(data ? 'ready' : 'off'); })
      .catch(() => setStatus((s) => (s === 'ready' ? s : 'error')));
  }, [storeId]);
  useEffect(() => {
    if (!storeId) return;
    const c = getCached(storeId);
    if (c) { setCatalog(c); setStatus('ready'); }
    load();
  }, [storeId, load]);

  // Los enlaces conservan ?tienda cuando no hay dominio propio.
  const href = useCallback((path) => (tienda ? `${path}?tienda=${encodeURIComponent(tienda)}` : path), [tienda]);
  const isHome = pathname.replace(/\/$/, '') === '/catalogo';
  const query = params.get('q') || '';

  // Edita parámetros del listado (q, cat, disp) sin perder los demás.
  // setParam('q', 'x') o setParam({ q: '', cat: '' }) para varios a la vez.
  const setParam = useCallback((keyOrPatch, value) => {
    const patch = typeof keyOrPatch === 'object' ? keyOrPatch : { [keyOrPatch]: value };
    if (isHome) {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
      setParams(next, { replace: true });
      return;
    }
    // Desde un producto, buscar lleva al listado con esa búsqueda.
    const s = new URLSearchParams();
    if (tienda) s.set('tienda', tienda);
    for (const [k, v] of Object.entries(patch)) if (v) s.set(k, v);
    navigate({ pathname: '/catalogo', search: s.toString() ? `?${s}` : '' });
  }, [params, isHome, tienda, setParams, navigate]);

  const goBack = useCallback(() => {
    if (window.history.state?.idx > 0) navigate(-1); else navigate(href('/catalogo'));
  }, [navigate, href]);

  const accent = store?.accent || '#0071e3';
  const rootStyle = { '--c-accent': accent, '--c-accent-ink': onAccent(accent) };

  let body;
  if (!store) {
    body = (brand.businessId === null && (!tienda || altDone))
      ? <Notice title="Tienda no encontrada" text="Esta dirección no corresponde a ningún catálogo." />
      : <Skeleton />;
  } else if (status === 'loading') body = <Skeleton />;
  else if (status === 'off') body = <Notice title="Catálogo no disponible" text={`${store.name} aún no ha publicado su catálogo. Vuelve pronto.`}>
      <Link className="cat-btn" to="/login">Acceso del negocio</Link>
    </Notice>;
  else if (status === 'error') {
    body = (
      <Notice title="No pudimos cargar el catálogo" text="Revisa tu conexión e inténtalo de nuevo.">
        <button className="cat-btn" onClick={() => { setStatus('loading'); load(); }}>Reintentar</button>
      </Notice>
    );
  } else {
    body = <Outlet context={{ store, catalog, href, params, setParam, query, goBack }} />;
  }

  return (
    <div className="cat" style={rootStyle}>
      <header className="cat-header">
        <div className="cat-header-in">
          <Link to={href('/catalogo')} className="cat-brand" aria-label={store ? `${store.name} — inicio del catálogo` : 'Catálogo'}>
            {store?.logoUrl
              ? <img src={store.logoUrl} alt={store.name} />
              : <span className="cat-wordmark">{store?.name || ''}</span>}
          </Link>
          {store && status === 'ready' && (
            <label className="cat-search">
              {Icon.search}
              <input type="search" inputMode="search" enterKeyHint="search" placeholder="Buscar productos"
                value={query} onChange={(e) => setParam('q', e.target.value)} aria-label="Buscar productos" />
              {query && (
                <button type="button" className="cat-search-clear" aria-label="Borrar búsqueda"
                  onClick={() => setParam('q', '')}>{Icon.close}</button>
              )}
            </label>
          )}
        </div>
      </header>

      <main>{body}</main>

      {store && status === 'ready' && (
        <footer className="cat-footer">
          <div className="cat-wrap">
            <p>Precios en dólares (USD). La disponibilidad puede cambiar sin previo aviso.</p>
            {catalog?.whatsapp && (
              <a href={whatsappLink(catalog.whatsapp, `Hola ${store.name}, vi su catálogo y quisiera más información.`)}
                target="_blank" rel="noreferrer">Escríbenos por WhatsApp</a>
            )}
            <small>© {new Date().getFullYear()} {store.name} · <Link to="/login">Acceso del negocio</Link></small>
          </div>
        </footer>
      )}
    </div>
  );
}
