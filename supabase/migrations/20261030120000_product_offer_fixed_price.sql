/*
# Ofertas: precio fijo además del %

Hasta ahora una oferta era un % de descuento (products.offer_percent). Ahora
también puede ser un precio fijo: "todos estos productos a $5".

- products.offer_price: precio de oferta en USD para TODAS las variantes del
  producto (NULL = sin precio fijo). Un producto tiene % o precio fijo, nunca
  los dos.
- set_products_offer(p_ids, p_percent, p_price): aplica el % o el precio fijo
  a la selección (y limpia el otro); ambos NULL quitan la oferta. p_price es
  opcional, así que las llamadas de antes (solo %) siguen funcionando.
- create_order: con precio fijo, la línea se cobra a ese precio; queda
  congelado en order_items.offer_price (offer_percent queda NULL).
- guard_product_update: cambiar offer_price exige el mismo permiso que el %.
- get_public_catalog: devuelve offer_price para el catálogo público.
*/

ALTER TABLE products ADD COLUMN IF NOT EXISTS offer_price numeric;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_offer_price_check;
ALTER TABLE products ADD CONSTRAINT products_offer_price_check
  CHECK (offer_price IS NULL OR offer_price > 0);
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_offer_one_kind_check;
ALTER TABLE products ADD CONSTRAINT products_offer_one_kind_check
  CHECK (offer_percent IS NULL OR offer_price IS NULL);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS offer_price numeric;

-- ---------- Aplicar/quitar oferta en lote: % o precio fijo ----------
DROP FUNCTION IF EXISTS public.set_products_offer(uuid[], numeric);

CREATE OR REPLACE FUNCTION public.set_products_offer(
  p_ids uuid[], p_percent numeric, p_price numeric DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid := public.current_business_id();
  n integer;
BEGIN
  IF b_id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  IF p_percent IS NOT NULL AND p_price IS NOT NULL THEN
    RAISE EXCEPTION 'La oferta es un %% o un precio fijo, no ambos';
  END IF;
  IF p_percent IS NOT NULL AND (p_percent <= 0 OR p_percent >= 100) THEN
    RAISE EXCEPTION 'El descuento debe estar entre 1 y 99';
  END IF;
  IF p_price IS NOT NULL AND p_price <= 0 THEN
    RAISE EXCEPTION 'El precio de oferta debe ser mayor que cero';
  END IF;
  UPDATE products SET offer_percent = p_percent, offer_price = round(p_price, 2)
   WHERE business_id = b_id AND id = ANY(COALESCE(p_ids, '{}'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION public.set_products_offer(uuid[], numeric, numeric) TO authenticated;

-- ---------- Guarda de permisos: offer_price cuenta como precio ----------
CREATE OR REPLACE FUNCTION public.guard_product_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Recálculos anidados (stock tras una venta o movimiento) y service role.
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF (NEW.name, NEW.sku, NEW.unit, NEW.note, NEW.variant_axes)
     IS DISTINCT FROM (OLD.name, OLD.sku, OLD.unit, OLD.note, OLD.variant_axes)
     AND NOT public.has_inventory_perm('inv_edit_info') THEN
    RAISE EXCEPTION 'No tienes permiso para editar los datos del producto';
  END IF;
  IF (NEW.price, NEW.cost, NEW.offer_percent, NEW.offer_price)
     IS DISTINCT FROM (OLD.price, OLD.cost, OLD.offer_percent, OLD.offer_price)
     AND NOT public.has_inventory_perm('inv_edit_price') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar precios, costos u ofertas';
  END IF;
  IF NEW.stock IS DISTINCT FROM OLD.stock
     AND NOT public.has_inventory_perm('inv_edit_stock') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar cantidades';
  END IF;
  RETURN NEW;
END $$;

-- ---------- create_order: precio fijo de oferta, congelado en la línea ----------
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
  offer numeric;
  offer_fixed numeric;
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
  pay_kind text;
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
    offer := NULLIF(COALESCE(prod.offer_percent, 0), 0);
    offer_fixed := NULLIF(COALESCE(prod.offer_price, 0), 0);
    IF offer_fixed IS NOT NULL THEN
      unit_price := offer_fixed;
      offer := NULL;
    ELSIF offer IS NOT NULL THEN
      unit_price := round(unit_price * (1 - offer / 100.0), 2);
    END IF;
    line_total := round(unit_price * qty, 2);
    v_total := v_total + line_total;

    SELECT string_agg(value, ' · ' ORDER BY key) INTO v_label
      FROM jsonb_each_text(var.attributes);

    INSERT INTO order_items (order_id, product_id, variant_id, name, variant_label,
                             unit, quantity, unit_price_usd, unit_cost_usd, offer_percent, offer_price, line_total_usd)
    VALUES (o.id, prod.id, var.id, prod.name, COALESCE(v_label, ''),
            prod.unit, qty, unit_price, COALESCE(var.cost, prod.cost, 0), offer, offer_fixed, line_total);

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
      pay_kind := COALESCE(pm.kind, 'normal');

      IF pay_currency = 'USD' THEN
        pay_amount_usd := pay_amount;
      ELSE
        pay_amount_usd := round(pay_amount / p_rate, 2);
      END IF;

      -- El descuento por pago en divisa premia el efectivo en dólares. Lo que
      -- financia Cashea llega por transferencia y en cuotas, así que no lo
      -- gana aunque el método esté en una cuenta en USD.
      IF pay_currency = 'USD' AND pay_kind <> 'cashea' THEN
        v_usd := v_usd + pay_amount;
      ELSE
        v_ves := v_ves + pay_amount_usd;
      END IF;

      INSERT INTO order_payments (order_id, method_id, method_name, account_id, account_name, currency, amount, amount_usd, kind)
      VALUES (o.id, pm.id, COALESCE(pm.name, pay->>'method_name', ''),
              ba.id, COALESCE(ba.name, pay->>'account_name', 'Pago'),
              pay_currency, pay_amount, pay_amount_usd, pay_kind);
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

-- ---------- get_public_catalog: + offer_price ----------
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
          'offer_price', p.offer_price,
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
