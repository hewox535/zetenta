/*
# Asignar acceso de sucursales a un usuario (solo admin del negocio)

set_user_branches(): el administrador define si un usuario ve todas las
sucursales (all_branches) o solo un conjunto específico (user_branches).
*/

CREATE OR REPLACE FUNCTION public.set_user_branches(p_user uuid, p_all boolean, p_branch_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bid uuid := public.current_business_id();
BEGIN
  IF NOT public.is_business_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user AND business_id = bid) THEN
    RAISE EXCEPTION 'User not in business';
  END IF;
  UPDATE profiles SET all_branches = COALESCE(p_all, false) WHERE id = p_user;
  DELETE FROM user_branches WHERE user_id = p_user;
  IF NOT COALESCE(p_all, false) AND p_branch_ids IS NOT NULL THEN
    INSERT INTO user_branches (user_id, branch_id)
    SELECT p_user, b.id FROM branches b
     WHERE b.business_id = bid AND b.id = ANY(p_branch_ids)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.set_user_branches(uuid, boolean, uuid[]) TO authenticated;

-- ---------- Alta de producto/variación con sucursal para el stock inicial ----------
-- p_branch_id opcional: el "Stock inicial" entra a esa sucursal (o a la Principal
-- si no se indica). Se eliminan las firmas previas para evitar ambigüedad.
DROP FUNCTION IF EXISTS public.create_product_with_variants(text, text, text, numeric, jsonb, text[], jsonb);

CREATE OR REPLACE FUNCTION public.create_product_with_variants(
  p_name text, p_sku text, p_unit text, p_price numeric,
  p_categories jsonb, p_variant_axes text[], p_variants jsonb, p_branch_id uuid DEFAULT NULL
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

  INSERT INTO products (business_id, name, sku, unit, price, variant_axes)
  VALUES (b_id, btrim(p_name), COALESCE(p_sku, ''), COALESCE(NULLIF(btrim(p_unit), ''), 'und'),
          COALESCE(p_price, 0), COALESCE(p_variant_axes, '{}'))
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
    INSERT INTO product_variants (business_id, product_id, sku, price, stock, attributes)
    VALUES (b_id, prod.id, COALESCE(v->>'sku', ''),
            NULLIF(v->>'price', '')::numeric, 0, attrs)
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

DROP FUNCTION IF EXISTS public.add_product_variant(uuid, jsonb, text, numeric, numeric);

CREATE OR REPLACE FUNCTION public.add_product_variant(
  p_product_id uuid, p_attributes jsonb, p_sku text, p_price numeric, p_stock numeric, p_branch_id uuid DEFAULT NULL
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

  INSERT INTO product_variants (business_id, product_id, sku, price, stock, attributes)
  VALUES (b_id, prod.id, COALESCE(p_sku, ''), p_price, 0, COALESCE(p_attributes, '{}'::jsonb))
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

GRANT EXECUTE ON FUNCTION public.create_product_with_variants(text, text, text, numeric, jsonb, text[], jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_product_variant(uuid, jsonb, text, numeric, numeric, uuid) TO authenticated;
