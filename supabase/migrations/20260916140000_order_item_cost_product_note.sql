/*
# Costo congelado en cada venta + nota del producto

1. order_items.unit_cost_usd: costo unitario al momento de la venta
   (variante o, si no tiene, producto). Congelarlo hace que la utilidad
   histórica no cambie cuando se edita el costo después. NULL en ventas
   anteriores a esta migración: Estadísticas usa el costo actual como
   aproximación.
2. products.note: nota libre del producto (p. ej. "Este pantalón tiene
   una mancha"). Se captura en el modal y se muestra en el inventario.

create_order mantiene su firma (solo cambia el cuerpo); los RPC de
producto reciben p_note al final con DEFAULT y se eliminan las firmas
previas para evitar ambigüedad en PostgREST.
*/

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost_usd numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';

-- ---------- create_order: congela el costo unitario en cada línea ----------
CREATE OR REPLACE FUNCTION public.create_order(
  p_items jsonb, p_payments jsonb, p_rate numeric, p_rate_source text,
  p_customer_name text, p_note text, p_customer_id uuid DEFAULT NULL, p_branch_id uuid DEFAULT NULL
) RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
  o orders%ROWTYPE;
  prod products%ROWTYPE;
  var product_variants%ROWTYPE;
  cust customers%ROWTYPE;
  br uuid;
  it jsonb;
  pay jsonb;
  seq integer;
  qty numeric;
  unit_price numeric;
  line_total numeric;
  v_total numeric := 0;
  v_ves numeric := 0;
  v_usd numeric := 0;
  v_name text;
  v_label text;
  v_disc numeric := 0;
  d numeric := 0;
  pending numeric;
  usd_needed numeric;
  covered numeric;
  pay_amount numeric;
  pay_amount_usd numeric;
  pay_currency text;
  pm payment_methods%ROWTYPE;
  ba bank_accounts%ROWTYPE;
BEGIN
  SELECT * INTO b FROM businesses WHERE id = public.current_business_id() FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  IF NOT COALESCE((b.capabilities->>'orders')::boolean, false) THEN
    RAISE EXCEPTION 'Orders capability is disabled for this business';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;
  IF p_rate IS NULL OR p_rate <= 0 THEN RAISE EXCEPTION 'Invalid rate'; END IF;

  br := p_branch_id;
  IF br IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches WHERE id = br AND business_id = b.id) THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;
  IF br IS NULL THEN br := public.default_branch_id(b.id); END IF;

  d := COALESCE(b.foreign_discount_percent, 0) / 100.0;
  IF d < 0 OR d >= 1 THEN d := 0; END IF;

  v_name := COALESCE(p_customer_name, '');
  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO cust FROM customers WHERE id = p_customer_id AND business_id = b.id;
    IF cust.id IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
    IF v_name = '' THEN v_name := cust.name; END IF;
  END IF;

  seq := b.order_seq;
  UPDATE businesses SET order_seq = order_seq + 1 WHERE id = b.id;

  INSERT INTO orders (business_id, number, customer_id, customer_name, note, rate, rate_source, created_by, branch_id)
  VALUES (b.id, lpad(seq::text, 6, '0'), p_customer_id, v_name, COALESCE(p_note, ''),
          p_rate, COALESCE(NULLIF(p_rate_source, ''), 'bcv_usd'), auth.uid(), br)
  RETURNING * INTO o;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO var FROM product_variants
      WHERE id = (it->>'variant_id')::uuid AND business_id = b.id;
    IF var.id IS NULL THEN RAISE EXCEPTION 'Variant not found'; END IF;
    SELECT * INTO prod FROM products WHERE id = var.product_id AND business_id = b.id;
    IF prod.id IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

    qty := COALESCE(NULLIF(it->>'quantity', '')::numeric, 0);
    IF qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;

    unit_price := COALESCE(var.price, prod.price);
    line_total := round(unit_price * qty, 2);
    v_total := v_total + line_total;

    SELECT string_agg(value, ' · ' ORDER BY key) INTO v_label
      FROM jsonb_each_text(var.attributes);

    INSERT INTO order_items (order_id, product_id, variant_id, name, variant_label,
                             unit, quantity, unit_price_usd, unit_cost_usd, line_total_usd)
    VALUES (o.id, prod.id, var.id, prod.name, COALESCE(v_label, ''),
            prod.unit, qty, unit_price, COALESCE(var.cost, prod.cost, 0), line_total);

    INSERT INTO inventory_movements (business_id, product_id, variant_id, branch_id, type, quantity, note, created_by, order_id)
    VALUES (b.id, prod.id, var.id, br, 'out', qty, 'Pedido ' || o.number, auth.uid(), o.id);
  END LOOP;

  IF p_payments IS NOT NULL THEN
    FOR pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      pay_amount := COALESCE(NULLIF(pay->>'amount', '')::numeric, 0);
      IF pay_amount <= 0 THEN CONTINUE; END IF;

      pm := NULL; ba := NULL;
      IF NULLIF(pay->>'method_id', '') IS NOT NULL THEN
        SELECT * INTO pm FROM payment_methods WHERE id = (pay->>'method_id')::uuid AND business_id = b.id;
      END IF;
      IF NULLIF(pay->>'account_id', '') IS NOT NULL THEN
        SELECT * INTO ba FROM bank_accounts WHERE id = (pay->>'account_id')::uuid AND business_id = b.id;
      ELSIF pm.id IS NOT NULL THEN
        SELECT * INTO ba FROM bank_accounts WHERE id = pm.account_id AND business_id = b.id;
      END IF;
      pay_currency := COALESCE(ba.currency, NULLIF(pay->>'currency', ''), 'VES');

      IF pay_currency = 'USD' THEN
        pay_amount_usd := pay_amount;
        v_usd := v_usd + pay_amount;
      ELSE
        pay_amount_usd := round(pay_amount / p_rate, 2);
        v_ves := v_ves + pay_amount_usd;
      END IF;

      INSERT INTO order_payments (order_id, method_id, method_name, account_id, account_name, currency, amount, amount_usd)
      VALUES (o.id, pm.id, COALESCE(pm.name, pay->>'method_name', ''),
              ba.id, COALESCE(ba.name, pay->>'account_name', 'Pago'),
              pay_currency, pay_amount, pay_amount_usd);
    END LOOP;
  END IF;

  pending := GREATEST(0, v_total - v_ves);
  usd_needed := round(pending * (1 - d), 2);
  IF v_usd + 0.01 >= usd_needed THEN
    v_disc := round(pending * d, 2);
  ELSE
    v_disc := round(v_usd * d / (1 - d), 2);
  END IF;
  covered := v_ves + CASE WHEN d > 0 THEN v_usd / (1 - d) ELSE v_usd END;

  IF covered + 0.01 < v_total THEN
    RAISE EXCEPTION 'Payments (%) do not cover the order total (%)', round(covered, 2), round(v_total, 2);
  END IF;

  UPDATE orders SET total_usd = v_total, total_ves = round(v_total * p_rate, 2), discount_usd = v_disc
   WHERE id = o.id RETURNING * INTO o;
  RETURN o;
END $$;

-- ---------- create_product_with_variants: + p_note ----------
DROP FUNCTION IF EXISTS public.create_product_with_variants(text, text, text, numeric, jsonb, text[], jsonb, uuid, numeric);

CREATE OR REPLACE FUNCTION public.create_product_with_variants(
  p_name text, p_sku text, p_unit text, p_price numeric,
  p_categories jsonb, p_variant_axes text[], p_variants jsonb,
  p_branch_id uuid DEFAULT NULL, p_cost numeric DEFAULT 0, p_note text DEFAULT ''
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

  INSERT INTO products (business_id, name, sku, unit, price, cost, note, variant_axes)
  VALUES (b_id, btrim(p_name), COALESCE(p_sku, ''), COALESCE(NULLIF(btrim(p_unit), ''), 'und'),
          COALESCE(p_price, 0), COALESCE(p_cost, 0), COALESCE(p_note, ''), COALESCE(p_variant_axes, '{}'))
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

-- ---------- update_product_details: + p_note ----------
DROP FUNCTION IF EXISTS public.update_product_details(uuid, text, text, text, numeric, jsonb, numeric);

CREATE OR REPLACE FUNCTION public.update_product_details(
  p_id uuid, p_name text, p_sku text, p_unit text, p_price numeric, p_categories jsonb,
  p_cost numeric DEFAULT 0, p_note text DEFAULT ''
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
    price = COALESCE(p_price, 0), cost = COALESCE(p_cost, 0), note = COALESCE(p_note, '')
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

GRANT EXECUTE ON FUNCTION public.create_product_with_variants(text, text, text, numeric, jsonb, text[], jsonb, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_details(uuid, text, text, text, numeric, jsonb, numeric, text) TO authenticated;
