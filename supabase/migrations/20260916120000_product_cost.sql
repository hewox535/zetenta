/*
# Precio de compra (costo) en productos y variantes

products.cost: costo unitario de compra, para calcular la utilidad de la
tienda. product_variants.cost: costo propio de la variante; NULL hereda el
del producto, igual que price.

Los RPC de alta/edición reciben el costo como parámetro final con DEFAULT;
se eliminan las firmas previas para evitar ambigüedad en PostgREST.
*/

ALTER TABLE products ADD COLUMN IF NOT EXISTS cost numeric NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS cost numeric;

-- ---------- create_product_with_variants: + p_cost y costo por variante ----------
DROP FUNCTION IF EXISTS public.create_product_with_variants(text, text, text, numeric, jsonb, text[], jsonb, uuid);

CREATE OR REPLACE FUNCTION public.create_product_with_variants(
  p_name text, p_sku text, p_unit text, p_price numeric,
  p_categories jsonb, p_variant_axes text[], p_variants jsonb,
  p_branch_id uuid DEFAULT NULL, p_cost numeric DEFAULT 0
) RETURNS products LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
  prod products%ROWTYPE;
  cat record;
  v jsonb;
  attrs jsonb;
  ax record;
  tax_id uuid;
  term_id uuid;
  var_id uuid;
  v_stock numeric;
BEGIN
  b_id := public.current_business_id();
  IF b_id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;
  IF p_variants IS NULL OR jsonb_array_length(p_variants) = 0 THEN
    RAISE EXCEPTION 'Se requiere al menos una variación';
  END IF;

  INSERT INTO products (business_id, name, sku, unit, price, cost, variant_axes)
  VALUES (b_id, btrim(p_name), COALESCE(p_sku, ''), COALESCE(NULLIF(btrim(p_unit), ''), 'und'),
          COALESCE(p_price, 0), COALESCE(p_cost, 0), COALESCE(p_variant_axes, '{}'))
  RETURNING * INTO prod;

  IF p_categories IS NOT NULL THEN
    FOR cat IN SELECT key, value FROM jsonb_each_text(p_categories) LOOP
      IF COALESCE(btrim(cat.value), '') = '' THEN CONTINUE; END IF;
      SELECT id INTO tax_id FROM taxonomies WHERE business_id = b_id AND name = cat.key;
      IF tax_id IS NULL THEN CONTINUE; END IF;
      INSERT INTO taxonomy_terms (taxonomy_id, name) VALUES (tax_id, btrim(cat.value))
        ON CONFLICT (taxonomy_id, name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO term_id;
      INSERT INTO product_terms (product_id, term_id) VALUES (prod.id, term_id)
        ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  FOR v IN SELECT * FROM jsonb_array_elements(p_variants) LOOP
    attrs := COALESCE(v->'attributes', '{}'::jsonb);
    INSERT INTO product_variants (business_id, product_id, sku, price, cost, stock, attributes)
    VALUES (b_id, prod.id, COALESCE(v->>'sku', ''),
            NULLIF(v->>'price', '')::numeric, NULLIF(v->>'cost', '')::numeric, 0, attrs)
    RETURNING id INTO var_id;

    v_stock := COALESCE(NULLIF(v->>'stock', '')::numeric, 0);
    IF v_stock > 0 THEN
      INSERT INTO inventory_movements (business_id, product_id, variant_id, branch_id, type, quantity, note, created_by)
      VALUES (b_id, prod.id, var_id, p_branch_id, 'in', v_stock, 'Stock inicial', auth.uid());
    END IF;

    FOR ax IN SELECT key, value FROM jsonb_each_text(attrs) LOOP
      IF COALESCE(btrim(ax.value), '') = '' THEN CONTINUE; END IF;
      SELECT id INTO tax_id FROM taxonomies WHERE business_id = b_id AND name = ax.key AND kind = 'variant';
      IF tax_id IS NULL THEN CONTINUE; END IF;
      INSERT INTO taxonomy_terms (taxonomy_id, name) VALUES (tax_id, btrim(ax.value))
        ON CONFLICT (taxonomy_id, name) DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN prod;
END $$;

-- ---------- add_product_variant: + p_cost ----------
DROP FUNCTION IF EXISTS public.add_product_variant(uuid, jsonb, text, numeric, numeric, uuid);

CREATE OR REPLACE FUNCTION public.add_product_variant(
  p_product_id uuid, p_attributes jsonb, p_sku text, p_price numeric, p_stock numeric,
  p_branch_id uuid DEFAULT NULL, p_cost numeric DEFAULT NULL
) RETURNS product_variants LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
  prod products%ROWTYPE;
  var product_variants%ROWTYPE;
  ax record;
  tax_id uuid;
BEGIN
  b_id := public.current_business_id();
  IF b_id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  SELECT * INTO prod FROM products WHERE id = p_product_id AND business_id = b_id;
  IF prod.id IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;

  INSERT INTO product_variants (business_id, product_id, sku, price, cost, stock, attributes)
  VALUES (b_id, prod.id, COALESCE(p_sku, ''), p_price, p_cost, 0, COALESCE(p_attributes, '{}'::jsonb))
  RETURNING * INTO var;

  IF COALESCE(p_stock, 0) > 0 THEN
    INSERT INTO inventory_movements (business_id, product_id, variant_id, branch_id, type, quantity, note, created_by)
    VALUES (b_id, prod.id, var.id, p_branch_id, 'in', p_stock, 'Stock inicial', auth.uid());
  END IF;

  FOR ax IN SELECT key, value FROM jsonb_each_text(COALESCE(p_attributes, '{}'::jsonb)) LOOP
    IF COALESCE(btrim(ax.value), '') = '' THEN CONTINUE; END IF;
    SELECT id INTO tax_id FROM taxonomies WHERE business_id = b_id AND name = ax.key AND kind = 'variant';
    IF tax_id IS NULL THEN CONTINUE; END IF;
    INSERT INTO taxonomy_terms (taxonomy_id, name) VALUES (tax_id, btrim(ax.value))
      ON CONFLICT (taxonomy_id, name) DO NOTHING;
  END LOOP;

  RETURN var;
END $$;

-- ---------- update_product_details: + p_cost ----------
DROP FUNCTION IF EXISTS public.update_product_details(uuid, text, text, text, numeric, jsonb);

CREATE OR REPLACE FUNCTION public.update_product_details(
  p_id uuid, p_name text, p_sku text, p_unit text, p_price numeric, p_categories jsonb,
  p_cost numeric DEFAULT 0
) RETURNS products LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
  prod products%ROWTYPE;
  cat record;
  tax_id uuid;
  term_id uuid;
BEGIN
  b_id := public.current_business_id();
  IF b_id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  SELECT * INTO prod FROM products WHERE id = p_id AND business_id = b_id;
  IF prod.id IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;

  UPDATE products SET
    name = btrim(p_name), sku = COALESCE(p_sku, ''),
    unit = COALESCE(NULLIF(btrim(p_unit), ''), 'und'),
    price = COALESCE(p_price, 0), cost = COALESCE(p_cost, 0)
   WHERE id = p_id RETURNING * INTO prod;

  -- Reemplaza categorías Y propiedades: quita todos los enlaces a términos
  -- de taxonomías del negocio (de cualquier kind) y re-inserta lo recibido.
  DELETE FROM product_terms pt
   USING taxonomy_terms tt JOIN taxonomies t ON t.id = tt.taxonomy_id
   WHERE pt.product_id = p_id AND pt.term_id = tt.id
     AND t.business_id = b_id;

  IF p_categories IS NOT NULL THEN
    FOR cat IN SELECT key, value FROM jsonb_each_text(p_categories) LOOP
      IF COALESCE(btrim(cat.value), '') = '' THEN CONTINUE; END IF;
      SELECT id INTO tax_id FROM taxonomies WHERE business_id = b_id AND name = cat.key;
      IF tax_id IS NULL THEN CONTINUE; END IF;
      INSERT INTO taxonomy_terms (taxonomy_id, name) VALUES (tax_id, btrim(cat.value))
        ON CONFLICT (taxonomy_id, name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO term_id;
      INSERT INTO product_terms (product_id, term_id) VALUES (p_id, term_id)
        ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN prod;
END $$;

GRANT EXECUTE ON FUNCTION public.create_product_with_variants(text, text, text, numeric, jsonb, text[], jsonb, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_product_variant(uuid, jsonb, text, numeric, numeric, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_details(uuid, text, text, text, numeric, jsonb, numeric) TO authenticated;
