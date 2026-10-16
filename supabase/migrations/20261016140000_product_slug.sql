/*
# Slug de producto para el catálogo público

products.slug: texto legible para la URL del catálogo (/catalogo/camisa-oxford)
en lugar del id. Único por negocio (si dos productos se llaman igual, el
segundo queda camisa-oxford-2). Se genera UNA vez al crear el producto y no
cambia si luego se renombra, para que los enlaces ya compartidos sigan vivos.

- products_set_slug(): trigger BEFORE INSERT; solo rellena si viene vacío.
- Backfill de los productos existentes (por antigüedad, para que el más viejo
  conserve el slug sin sufijo).
- get_public_catalog devuelve `slug` por producto (el front acepta también el
  id antiguo y redirige).
*/

ALTER TABLE products ADD COLUMN IF NOT EXISTS slug text;

CREATE OR REPLACE FUNCTION public.slugify(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(left(btrim(regexp_replace(
    lower(translate(COALESCE(p_text, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')),
    '[^a-z0-9]+', '-', 'g'), '-'), 60), ''), 'producto');
$$;

CREATE OR REPLACE FUNCTION public.next_product_slug(p_business uuid, p_name text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  base text := public.slugify(p_name);
  candidate text := base;
  n integer := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM products WHERE business_id = p_business AND slug = candidate) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  RETURN candidate;
END $$;

CREATE OR REPLACE FUNCTION public.products_set_slug()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.next_product_slug(NEW.business_id, NEW.name);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS products_set_slug ON products;
CREATE TRIGGER products_set_slug BEFORE INSERT ON products
  FOR EACH ROW EXECUTE FUNCTION public.products_set_slug();

-- Backfill: del más antiguo al más nuevo
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, business_id, name FROM products WHERE slug IS NULL ORDER BY created_at, id LOOP
    UPDATE products SET slug = public.next_product_slug(r.business_id, r.name) WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS products_business_slug_key ON products (business_id, slug);

-- ---------- get_public_catalog: ahora incluye slug ----------
CREATE OR REPLACE FUNCTION public.get_public_catalog(p_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
  cat_tax uuid;
  result jsonb;
BEGIN
  SELECT * INTO b FROM businesses WHERE id = p_business;
  IF b.id IS NULL OR NOT b.catalog_enabled THEN RETURN NULL; END IF;

  SELECT id INTO cat_tax FROM taxonomies
   WHERE business_id = b.id AND kind = 'category'
   ORDER BY (name = 'Categoría') DESC, created_at
   LIMIT 1;

  SELECT jsonb_build_object(
    'whatsapp', b.catalog_whatsapp,
    'tagline', b.catalog_tagline,
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
        FROM taxonomy_terms t WHERE t.taxonomy_id = cat_tax
    ), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(prod ORDER BY (prod->>'available') DESC, prod->>'name')
      FROM (
        SELECT jsonb_build_object(
          'id', p.id,
          'slug', p.slug,
          'name', p.name,
          'price', p.price,
          'offer_percent', p.offer_percent,
          'axes', to_jsonb(p.variant_axes),
          'category_ids', COALESCE((
            SELECT jsonb_agg(pt.term_id) FROM product_terms pt
              JOIN taxonomy_terms tt ON tt.id = pt.term_id AND tt.taxonomy_id = cat_tax
             WHERE pt.product_id = p.id
          ), '[]'::jsonb),
          'available', EXISTS (
            SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.active AND v.stock > 0
          ),
          'variants', (
            SELECT jsonb_agg(jsonb_build_object(
                     'id', v.id,
                     'attributes', v.attributes,
                     'price', v.price,
                     'available', v.stock > 0
                   ) ORDER BY v.created_at)
              FROM product_variants v WHERE v.product_id = p.id AND v.active
          ),
          'media', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                     'id', m.id, 'variant_id', m.variant_id, 'bucket', m.bucket, 'path', m.path
                   ) ORDER BY m.sort_order, m.created_at)
              FROM product_media m WHERE m.product_id = p.id AND m.provider = 'supabase'
          ), '[]'::jsonb)
        ) AS prod
        FROM products p
        WHERE p.business_id = b.id
          AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.active)
      ) x
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END $$;
