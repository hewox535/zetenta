/*
# White label por dominio (Fase 1)

Cada negocio puede tener su propia "piel" según el dominio por el que se entra,
sin desplegar copias de la app. La arquitectura ya es multi-tenant (RLS por
business_id); esto solo decide la apariencia antes de autenticar.

- businesses.slug: subdominio de la plataforma (p. ej. "robert-clothes" →
  robert-clothes.hewox.com).
- businesses.custom_domain: dominio propio del cliente (p. ej.
  tienda.robert.com), coincidencia exacta.
- businesses.branding: { name, logo_url, accent } — solo apariencia.
- get_branding(host): función pública (ejecutable por anon) que resuelve el
  host a la marca del negocio. Devuelve SOLO campos de marca, nunca datos
  fiscales. La configura el administrador de la plataforma (RLS de businesses
  ya permite UPDATE solo a platform_admin).
*/

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS custom_domain text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS branding jsonb NOT NULL DEFAULT '{}';

-- Únicos, ignorando NULL (varios negocios sin dominio configurado conviven).
CREATE UNIQUE INDEX IF NOT EXISTS businesses_slug_key ON businesses (slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS businesses_custom_domain_key ON businesses (custom_domain) WHERE custom_domain IS NOT NULL;

-- Resuelve el host a la marca. Coincide por dominio propio exacto o por el
-- primer segmento del host contra el slug (robert-clothes.hewox.com → slug
-- "robert-clothes"). SECURITY DEFINER + STABLE, ejecutable sin sesión.
CREATE OR REPLACE FUNCTION public.get_branding(p_host text)
RETURNS TABLE (business_id uuid, name text, logo_url text, accent text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id,
         COALESCE(NULLIF(b.branding->>'name', ''), b.name),
         b.branding->>'logo_url',
         COALESCE(NULLIF(b.branding->>'accent', ''), '')
  FROM businesses b
  WHERE b.custom_domain = lower(p_host)
     OR (b.slug IS NOT NULL AND b.slug = split_part(lower(p_host), '.', 1))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_branding(text) TO anon, authenticated;
