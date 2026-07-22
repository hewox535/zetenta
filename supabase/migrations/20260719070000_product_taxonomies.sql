/*
# Taxonomías de productos por negocio

Cada negocio define sus propias taxonomías para clasificar el inventario
(Marca, Modelo, Talla, Categoría…) con valores (términos) libres.
Al crearse un negocio se siembran "Marca" y "Modelo" para que la
clasificación funcione sin configuración previa; el backfill hace lo mismo
para los negocios existentes.

- taxonomies: la dimensión (p. ej. "Marca"), única por negocio.
- taxonomy_terms: los valores (p. ej. "Toyota"), únicos por taxonomía.
- product_terms: relación producto ↔ término.

RLS: mismas reglas del resto de la plataforma — cada negocio ve y gestiona
solo lo suyo; los administradores de la plataforma pueden leer todo.
*/

CREATE TABLE taxonomies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE TABLE taxonomy_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taxonomy_id uuid NOT NULL REFERENCES taxonomies(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (taxonomy_id, name)
);

CREATE TABLE product_terms (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES taxonomy_terms(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, term_id)
);

CREATE INDEX idx_taxonomies_business ON taxonomies (business_id);
CREATE INDEX idx_terms_taxonomy ON taxonomy_terms (taxonomy_id);
CREATE INDEX idx_product_terms_term ON product_terms (term_id);

-- ---------- Siembra: todo negocio nace con Marca y Modelo ----------
CREATE OR REPLACE FUNCTION public.seed_default_taxonomies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO taxonomies (business_id, name) VALUES (NEW.id, 'Marca'), (NEW.id, 'Modelo');
  RETURN NEW;
END $$;

CREATE TRIGGER on_business_created
  AFTER INSERT ON businesses
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_taxonomies();

-- Backfill para los negocios ya existentes
INSERT INTO taxonomies (business_id, name)
SELECT b.id, v.name FROM businesses b CROSS JOIN (VALUES ('Marca'), ('Modelo')) v(name)
ON CONFLICT DO NOTHING;

-- ---------- Row Level Security ----------
ALTER TABLE taxonomies ENABLE ROW LEVEL SECURITY;
ALTER TABLE taxonomy_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY taxonomies_select ON taxonomies FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
CREATE POLICY taxonomies_insert ON taxonomies FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());
CREATE POLICY taxonomies_update ON taxonomies FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY taxonomies_delete ON taxonomies FOR DELETE TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY terms_select ON taxonomy_terms FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM taxonomies t WHERE t.id = taxonomy_id
      AND (t.business_id = public.current_business_id() OR public.is_platform_admin())
  ));
CREATE POLICY terms_insert ON taxonomy_terms FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM taxonomies t WHERE t.id = taxonomy_id AND t.business_id = public.current_business_id()
  ));
CREATE POLICY terms_update ON taxonomy_terms FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM taxonomies t WHERE t.id = taxonomy_id AND t.business_id = public.current_business_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM taxonomies t WHERE t.id = taxonomy_id AND t.business_id = public.current_business_id()
  ));
CREATE POLICY terms_delete ON taxonomy_terms FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM taxonomies t WHERE t.id = taxonomy_id AND t.business_id = public.current_business_id()
  ));

CREATE POLICY product_terms_select ON product_terms FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_id
      AND (p.business_id = public.current_business_id() OR public.is_platform_admin())
  ));
CREATE POLICY product_terms_insert ON product_terms FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.business_id = public.current_business_id())
    AND EXISTS (
      SELECT 1 FROM taxonomy_terms tt JOIN taxonomies t ON t.id = tt.taxonomy_id
      WHERE tt.id = term_id AND t.business_id = public.current_business_id()
    )
  );
CREATE POLICY product_terms_delete ON product_terms FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_id AND p.business_id = public.current_business_id()
  ));
