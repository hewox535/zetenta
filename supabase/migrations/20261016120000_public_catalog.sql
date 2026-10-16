/*
# Catálogo público (white label)

Cada negocio puede publicar su catálogo en `/catalogo` bajo su propio dominio.
Es una vitrina, no una tienda: el cliente ve productos, variantes y si hay o no
disponibilidad, y escribe por WhatsApp para comprar.

- businesses.catalog_enabled: apagado por defecto; el negocio decide cuándo
  publicar. Apagado, get_public_catalog devuelve NULL (la página dice "no
  disponible") y no se filtra nada.
- businesses.catalog_whatsapp / catalog_tagline: contacto (solo dígitos, con
  código de país) y frase corta bajo el título del catálogo.
- set_catalog_settings(): solo el administrador del negocio las cambia.
- get_public_catalog(p_business): SECURITY DEFINER, ejecutable por anon. Es la
  ÚNICA puerta pública a los datos de producto y devuelve una lista blanca:
    · nunca stock/cantidades (solo `available` boolean por variante), ni costo,
      SKU, notas internas ni sucursales;
    · solo variantes activas; un producto sin ninguna variante activa no sale;
    · las categorías salen de la taxonomía "Categoría" (o, si el negocio no la
      tiene, la primera taxonomía de tipo category).
- Roma queda con el catálogo activo (es quien lo pidió).
*/

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS catalog_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS catalog_whatsapp text NOT NULL DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS catalog_tagline text NOT NULL DEFAULT '';

-- ---------- Ajustes del catálogo (administrador del negocio) ----------
CREATE OR REPLACE FUNCTION public.set_catalog_settings(p_enabled boolean, p_whatsapp text, p_tagline text)
RETURNS businesses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
  digits text := regexp_replace(COALESCE(p_whatsapp, ''), '\D', '', 'g');
BEGIN
  IF NOT public.is_business_admin() THEN
    RAISE EXCEPTION 'Solo un administrador del negocio puede configurar el catálogo';
  END IF;
  IF digits <> '' AND length(digits) NOT BETWEEN 8 AND 15 THEN
    RAISE EXCEPTION 'El WhatsApp debe incluir el código de país (por ejemplo 584141234567)';
  END IF;
  UPDATE businesses
     SET catalog_enabled = COALESCE(p_enabled, false),
         catalog_whatsapp = digits,
         catalog_tagline = left(btrim(COALESCE(p_tagline, '')), 140)
   WHERE id = public.current_business_id()
   RETURNING * INTO b;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  RETURN b;
END $$;

-- ---------- Lectura pública del catálogo ----------
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

GRANT EXECUTE ON FUNCTION public.get_public_catalog(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_catalog_settings(boolean, text, text) TO authenticated;

-- Roma publica su catálogo (data operativa; migración por ser el único canal remoto).
UPDATE businesses SET catalog_enabled = true WHERE slug = 'roma';
