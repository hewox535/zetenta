import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// White label por dominio: al arrancar resolvemos window.location.hostname → marca
// del negocio (nombre, logo, acento) y la aplicamos ANTES de autenticar. El tenant
// real de los datos lo sigue decidiendo el usuario logueado (RLS); el dominio solo
// decide la apariencia. Sin match → marca Zetenta por defecto.
//
// Anti-parpadeo: cacheamos la marca resuelta en localStorage por host. En visitas
// siguientes se aplica de inmediato (fromCache) sin mostrar "zetenta" primero;
// mientras tanto revalidamos en segundo plano. En la primera visita, la app
// espera al RPC mostrando un splash neutro (no una marca equivocada).

const DEFAULT = { name: 'zetenta', logoUrl: null, accent: null, businessId: null };
const BrandingContext = createContext({ ...DEFAULT, ready: false, fromCache: false });

const host = typeof window !== 'undefined' ? window.location.hostname : '';
const CACHE_KEY = `zt-brand:${host}`;

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeCache(b) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(b)); } catch { /* almacenamiento no disponible */ }
}

// Crea o actualiza una etiqueta <meta> por su atributo identificador (name/property).
function setMeta(attr, key, value) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

export function BrandingProvider({ children }) {
  const cached = readCache();
  const [branding, setBranding] = useState(
    cached ? { ...DEFAULT, ...cached, ready: false, fromCache: true }
           : { ...DEFAULT, ready: false, fromCache: false }
  );

  useEffect(() => {
    let active = true;
    supabase.rpc('get_branding', { p_host: host })
      .then(({ data }) => {
        if (!active) return;
        const b = Array.isArray(data) ? data[0] : data;
        const next = b
          ? { name: b.name || 'zetenta', logoUrl: b.logo_url || null, accent: b.accent || null, businessId: b.business_id }
          : { ...DEFAULT };
        writeCache(next);
        setBranding({ ...next, ready: true, fromCache: false });
      })
      .catch(() => setBranding((prev) => ({ ...prev, ready: true })));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const branded = branding.name && branding.name !== 'zetenta';
    const title = branded ? branding.name : 'Zetenta';
    const accent = branding.accent || '#0071e3';

    if (branding.accent) {
      root.style.setProperty('--accent', branding.accent);
      root.style.setProperty('--accent-hover', branding.accent);
      root.style.setProperty('--accent-soft', `color-mix(in srgb, ${branding.accent} 10%, transparent)`);
      root.style.setProperty('--accent-ring', `color-mix(in srgb, ${branding.accent} 22%, transparent)`);
      root.style.setProperty('--accent-line', `color-mix(in srgb, ${branding.accent} 40%, transparent)`);
    }

    // Identidad dinámica: título, favicon y meta de SEO reflejan el negocio del dominio
    document.title = title;
    const description = branded
      ? `${branding.name} — pedidos, inventario y gestión de tu negocio.`
      : 'Zetenta — gestión de negocio: pedidos, inventario, retenciones y estadísticas en un solo lugar.';

    setMeta('name', 'description', description);
    setMeta('name', 'theme-color', accent);
    setMeta('name', 'apple-mobile-web-app-title', title);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:site_name', title);
    setMeta('property', 'og:description', description);

    if (branding.logoUrl) {
      let link = document.querySelector("link[rel='icon']");
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = branding.logoUrl;
      let apple = document.querySelector("link[rel='apple-touch-icon']");
      if (apple) apple.href = branding.logoUrl;
    }
  }, [branding]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  return useContext(BrandingContext);
}
