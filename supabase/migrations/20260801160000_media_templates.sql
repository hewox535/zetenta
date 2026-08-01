/*
# Plantillas por tipo de negocio + medios de producto (imágenes)

1) Tipo de negocio y plantillas
   - businesses.business_type ('general' | 'ropa'). Se recibe en el registro.
   - Al crear el negocio se siembran taxonomías/valores según el tipo:
     · ropa    → Categoría (libre) + Talla (S,M,L,XL,XXL) + Color (comunes).
     · general → Marca, Modelo (como hasta ahora).

2) Medios de producto (imágenes)
   - product_media: guarda provider/bucket/path (NO una URL completa) para que
     migrar de storage en el futuro sea trivial. Asocia a un producto y,
     opcionalmente, a una variación (imagen por color, etc.).
   - Bucket público 'product-media' en Supabase Storage + RLS: cada negocio solo
     escribe en su carpeta ({business_id}/…); lectura pública.
*/

-- ---------- Tipo de negocio ----------
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_type text NOT NULL DEFAULT 'general';

-- ---------- Siembra por tipo de negocio ----------
CREATE OR REPLACE FUNCTION public.seed_default_taxonomies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t_talla uuid;
  t_color uuid;
BEGIN
  IF NEW.business_type = 'ropa' THEN
    INSERT INTO taxonomies (business_id, name, kind) VALUES (NEW.id, 'Categoría', 'category');
    INSERT INTO taxonomies (business_id, name, kind) VALUES (NEW.id, 'Talla', 'variant') RETURNING id INTO t_talla;
    INSERT INTO taxonomies (business_id, name, kind) VALUES (NEW.id, 'Color', 'variant') RETURNING id INTO t_color;
    INSERT INTO taxonomy_terms (taxonomy_id, name)
      SELECT t_talla, v FROM unnest(ARRAY['S','M','L','XL','XXL']) v;
    INSERT INTO taxonomy_terms (taxonomy_id, name)
      SELECT t_color, v FROM unnest(ARRAY['Negro','Blanco','Azul','Rojo','Gris','Beige','Rosa','Verde']) v;
  ELSE
    INSERT INTO taxonomies (business_id, name, kind) VALUES (NEW.id, 'Marca', 'category'), (NEW.id, 'Modelo', 'category');
  END IF;
  RETURN NEW;
END $$;

-- ---------- Registro: pasa el tipo de negocio al crear ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'business_name', '') <> '' THEN
    INSERT INTO businesses (name, business_type)
    VALUES (NEW.raw_user_meta_data->>'business_name',
            COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_type', ''), 'general'))
    RETURNING id INTO b_id;
    INSERT INTO payment_methods (business_id, name, currency, sort_order) VALUES
      (b_id, 'Pago móvil', 'VES', 0),
      (b_id, 'Dólares', 'USD', 1);
  END IF;
  INSERT INTO profiles (id, business_id, full_name, email)
  VALUES (NEW.id, b_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), COALESCE(NEW.email, ''));
  RETURN NEW;
END $$;

-- ---------- Medios de producto ----------
CREATE TABLE product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'supabase',
  bucket text NOT NULL DEFAULT 'product-media',
  path text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_media_product ON product_media (product_id, sort_order);
CREATE INDEX idx_product_media_variant ON product_media (variant_id);

ALTER TABLE product_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_media_select ON product_media FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
CREATE POLICY product_media_insert ON product_media FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id()
    AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.business_id = public.current_business_id()));
CREATE POLICY product_media_update ON product_media FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY product_media_delete ON product_media FOR DELETE TO authenticated
  USING (business_id = public.current_business_id());

-- ---------- Bucket de Storage + RLS ----------
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-media', 'product-media', true)
ON CONFLICT (id) DO NOTHING;

-- Lectura pública; escritura/borrado solo en la carpeta del propio negocio.
DROP POLICY IF EXISTS "product-media read" ON storage.objects;
CREATE POLICY "product-media read" ON storage.objects FOR SELECT
  USING (bucket_id = 'product-media');

DROP POLICY IF EXISTS "product-media insert" ON storage.objects;
CREATE POLICY "product-media insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-media'
    AND (storage.foldername(name))[1] = public.current_business_id()::text);

DROP POLICY IF EXISTS "product-media update" ON storage.objects;
CREATE POLICY "product-media update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-media' AND (storage.foldername(name))[1] = public.current_business_id()::text);

DROP POLICY IF EXISTS "product-media delete" ON storage.objects;
CREATE POLICY "product-media delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-media' AND (storage.foldername(name))[1] = public.current_business_id()::text);
