/*
# Productos sin control de inventario (helados, bebidas preparadas…)

Algunos productos no se cuentan por unidades: un helado de máquina no tiene
"stock" de vasitos vendidos. Para ellos:

- products.track_stock (por defecto true: nada cambia para los existentes).
  En false, vender no genera salida de inventario ni toca el stock, y cancelar
  la venta tampoco genera entrada (cancel_order solo devuelve lo que salió).
- variant_stock.available: interruptor "Disponible / Agotado" por variante y
  sucursal. Solo cuenta para productos sin control de inventario: create_order
  rechaza venderlo en una sucursal que lo marcó agotado.
- set_variant_available(): cambia ese interruptor (permiso de cambiar
  cantidades y acceso a la sucursal).
- Catálogo público: un producto sin control de inventario está disponible si
  alguna sucursal activa no lo marcó agotado.
- Cambiar track_stock exige el mismo permiso que cambiar cantidades.
*/

ALTER TABLE products ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true;
ALTER TABLE variant_stock ADD COLUMN IF NOT EXISTS available boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.set_variant_available(p_variant_id uuid, p_branch_id uuid, p_available boolean)
RETURNS variant_stock LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bid uuid := public.current_business_id();
  r variant_stock%ROWTYPE;
BEGIN
  IF NOT public.has_inventory_perm('inv_edit_stock') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar la disponibilidad';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM product_variants WHERE id = p_variant_id AND business_id = bid) THEN
    RAISE EXCEPTION 'Variant not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id AND business_id = bid) THEN
    RAISE EXCEPTION 'Sucursal no válida';
  END IF;
  IF NOT public.can_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'No tienes acceso a esta sucursal';
  END IF;
  INSERT INTO variant_stock (business_id, variant_id, branch_id, stock, available)
    VALUES (bid, p_variant_id, p_branch_id, 0, COALESCE(p_available, true))
    ON CONFLICT (variant_id, branch_id) DO UPDATE SET available = EXCLUDED.available
    RETURNING * INTO r;
  RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION public.set_variant_available(uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_product_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  IF (NEW.stock, NEW.track_stock) IS DISTINCT FROM (OLD.stock, OLD.track_stock)
     AND NOT public.has_inventory_perm('inv_edit_stock') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar cantidades';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.create_order(p_items jsonb, p_payments jsonb, p_rate numeric, p_rate_source text, p_customer_name text, p_note text, p_customer_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid, p_credit_due date DEFAULT NULL::date, p_foreign_discount numeric DEFAULT NULL::numeric, p_local_discount numeric DEFAULT NULL::numeric, p_skip_discounts uuid[] DEFAULT NULL::uuid[], p_discount_id uuid DEFAULT NULL::uuid, p_custom_percent numeric DEFAULT NULL::numeric, p_custom_name text DEFAULT NULL::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_credit numeric := 0;
  dv numeric := 0;
  v_list numeric := 0;
  has_cashea boolean := false;
  ds discounts%ROWTYPE;
  promo_pct numeric := 0;
  v_promo numeric := 0;     -- con Cashea: lo que rebaja el descuento especial
  v_due numeric;            -- lo que hay que cubrir (lista, o lista − promo con Cashea)
  t_ves numeric := 0;       -- de contado: la venta neta si todo se pagara en Bs
  t_usd numeric := 0;       -- … y si todo se pagara en divisa
  line_pct numeric;
  n_hit integer := 0;       -- artículos a los que aplicó el descuento especial
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

  -- Descuentos de contado: los del negocio, salvo que la venta mande otros
  -- (la vendedora puede desmarcarlos o cambiar el % en el cobro).
  d := COALESCE(p_foreign_discount, b.foreign_discount_percent, 0) / 100.0;
  IF d < 0 OR d >= 1 THEN d := 0; END IF;
  dv := COALESCE(p_local_discount, b.local_discount_percent, 0) / 100.0;
  IF dv < 0 OR dv >= 1 THEN dv := 0; END IF;

  -- Cashea elegido en la venta (aunque llegue sin monto): sin descuentos de contado.
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_payments, '[]'::jsonb)) x
      JOIN payment_methods cm ON cm.id = NULLIF(x->>'method_id', '')::uuid AND cm.business_id = b.id
     WHERE cm.kind = 'cashea'
  ) INTO has_cashea;

  -- Descuento especial que eligió la cajera (Black Friday…): aplica a toda la
  -- venta con su % de contado o su % de Cashea. De contado no se suma al de
  -- la moneda: se queda el mayor de los dos.
  IF p_discount_id IS NOT NULL THEN
    SELECT * INTO ds FROM discounts
     WHERE id = p_discount_id AND business_id = b.id AND active
       AND (starts_on IS NULL OR starts_on <= (now() AT TIME ZONE 'America/Caracas')::date)
       AND (ends_on IS NULL OR ends_on >= (now() AT TIME ZONE 'America/Caracas')::date);
    IF ds.id IS NULL THEN RAISE EXCEPTION 'El descuento elegido ya no está disponible'; END IF;
    promo_pct := COALESCE(CASE WHEN has_cashea THEN ds.cashea_percent ELSE ds.cash_percent END, 0) / 100.0;
    IF promo_pct < 0 OR promo_pct >= 1 THEN promo_pct := 0; END IF;
  ELSIF COALESCE(p_custom_percent, 0) > 0 THEN
    -- Descuento personalizado que escribió la cajera: un % para toda la venta
    -- (de contado o con Cashea) y un nombre opcional.
    promo_pct := LEAST(p_custom_percent, 99) / 100.0;
    ds.name := COALESCE(NULLIF(btrim(p_custom_name), ''), 'Descuento personalizado');
    ds.term_ids := '{}';
  END IF;

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

    -- Descuento especial: a todo, o solo a los productos de sus categorías.
    line_pct := 0;
    IF promo_pct > 0 AND (cardinality(ds.term_ids) = 0 OR EXISTS (
         SELECT 1 FROM product_terms pt WHERE pt.product_id = prod.id AND pt.term_id = ANY (ds.term_ids))) THEN
      line_pct := promo_pct;
      n_hit := n_hit + 1;
    END IF;
    IF has_cashea THEN
      v_promo := v_promo + round(line_total * line_pct, 2);
    ELSE
      -- De contado no se suma al de la moneda: en cada artículo, el mayor.
      t_ves := t_ves + line_total * (1 - GREATEST(line_pct, dv));
      t_usd := t_usd + line_total * (1 - GREATEST(line_pct, d));
    END IF;

    SELECT string_agg(value, ' · ' ORDER BY key) INTO v_label
      FROM jsonb_each_text(var.attributes);

    INSERT INTO order_items (order_id, product_id, variant_id, name, variant_label,
                             unit, quantity, unit_price_usd, unit_cost_usd, offer_percent, offer_price, line_total_usd)
    VALUES (o.id, prod.id, var.id, prod.name, COALESCE(v_label, ''),
            prod.unit, qty, unit_price, COALESCE(var.cost, prod.cost, 0), offer, offer_fixed, line_total);

    IF prod.track_stock THEN
      INSERT INTO inventory_movements (business_id, product_id, variant_id, branch_id, type, quantity, note, created_by, order_id)
      VALUES (b.id, prod.id, var.id, br, 'out', qty, 'Pedido ' || o.number, auth.uid(), o.id);
    ELSIF EXISTS (SELECT 1 FROM variant_stock vs WHERE vs.variant_id = var.id AND vs.branch_id = br AND NOT vs.available) THEN
      -- Sin control de inventario: solo se vende si la sucursal no lo marcó agotado.
      RAISE EXCEPTION '% está agotado en esta sucursal', prod.name;
    END IF;
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
      -- Tres bolsas: lo que financia Cashea (a precio de lista), el contado
      -- en bolívares y el contado en divisa, cada uno con su descuento.
      IF pay_kind = 'cashea' THEN
        v_list := v_list + pay_amount_usd;
      ELSIF pay_currency = 'USD' THEN
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

  -- Una compra con Cashea va a precio de lista (la app de Cashea calcula la
  -- inicial sobre ese precio): sin descuentos de contado.
  IF v_list > 0 OR has_cashea THEN d := 0; dv := 0; END IF;
  -- Con Cashea la venta va a lista menos el descuento especial; de contado,
  -- cada moneda "rinde" según qué artículos llevan el especial.
  v_due := v_total - v_promo;
  IF NOT has_cashea AND n_hit > 0 AND v_total > 0 THEN
    dv := LEAST(0.99, GREATEST(0, 1 - t_ves / v_total));
    d := LEAST(0.99, GREATEST(0, 1 - t_usd / v_total));
  END IF;

  -- Lo que no cubre Cashea se liquida primero con bolívares y luego con
  -- divisa. Cada pago "rinde" amt / (1 − su descuento); el descuento
  -- concedido es lo que rindió de más, sin pasar del saldo que cubre.
  pending := v_due - v_list;
  v_disc := 0;
  IF pending > 0 AND v_ves > 0 THEN
    IF v_ves + 0.01 >= round(pending * (1 - dv), 2) THEN
      v_disc := round(pending * dv, 2);
      pending := 0;
    ELSE
      v_disc := round(v_ves * dv / (1 - dv), 2);
      pending := pending - v_ves / (1 - dv);
    END IF;
  END IF;
  IF pending > 0 AND v_usd > 0 THEN
    usd_needed := round(pending * (1 - d), 2);
    IF v_usd + 0.01 >= usd_needed THEN
      v_disc := v_disc + round(pending * d, 2);
    ELSE
      v_disc := v_disc + round(v_usd * d / (1 - d), 2);
    END IF;
  END IF;
  covered := v_list
    + CASE WHEN dv > 0 THEN v_ves / (1 - dv) ELSE v_ves END
    + CASE WHEN d > 0 THEN v_usd / (1 - d) ELSE v_usd END;

  IF covered + 0.01 < v_due THEN
    -- Venta a crédito: lo que no se cobró queda como cuenta por cobrar del
    -- cliente. Sin cliente o sin fecha de vencimiento no se puede fiar.
    IF p_credit_due IS NULL THEN
      RAISE EXCEPTION 'Payments (%) do not cover the order total (%)', round(covered, 2), round(v_due, 2);
    END IF;
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'Para vender a crédito hay que elegir el cliente';
    END IF;
    v_credit := round(v_due - covered, 2);
  END IF;

  UPDATE orders SET total_usd = v_total, total_ves = round(v_total * p_rate, 2), discount_usd = v_disc + v_promo,
                    discount_id = CASE WHEN n_hit > 0 THEN ds.id END,
                    discount_name = CASE WHEN n_hit > 0 THEN ds.name END,
                    discount_percent = CASE WHEN n_hit > 0 THEN round(promo_pct * 100, 2) END,
                    credit_usd = v_credit
   WHERE id = o.id RETURNING * INTO o;

  IF v_credit > 0 THEN
    INSERT INTO debts (business_id, branch_id, kind, party_type, customer_id, party_name,
                       concept, amount_usd, issue_date, due_date, order_id, created_by)
    VALUES (b.id, br, 'receivable', 'customer', p_customer_id, v_name,
            'Venta Nº ' || o.number, v_credit, current_date, p_credit_due, o.id, auth.uid());
  END IF;
  RETURN o;
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_pin text, p_reason text DEFAULT ''::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b_id uuid;
  o orders%ROWTYPE;
  hash text;
  it record;
BEGIN
  b_id := public.current_business_id();
  IF b_id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;

  SELECT * INTO o FROM orders WHERE id = p_order_id AND business_id = b_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF o.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Esa venta ya está cancelada'; END IF;

  SELECT cancel_pin_hash INTO hash FROM business_secrets WHERE business_id = b_id;
  IF hash IS NULL THEN
    RAISE EXCEPTION 'Este negocio aún no tiene PIN de cancelación; configúralo en Negocio → Ventas';
  END IF;
  IF p_pin IS NULL OR extensions.crypt(btrim(p_pin), hash) <> hash THEN
    RAISE EXCEPTION 'PIN incorrecto';
  END IF;

  -- El stock vuelve: una entrada por cada línea, a la sucursal de la venta.
  FOR it IN SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = o.id LOOP
    -- Solo vuelve lo que salió: los productos sin control de inventario no
    -- generaron salida al vender.
    IF it.variant_id IS NOT NULL AND it.quantity > 0 AND EXISTS (
         SELECT 1 FROM inventory_movements m
          WHERE m.order_id = o.id AND m.variant_id = it.variant_id AND m.type = 'out') THEN
      INSERT INTO inventory_movements (business_id, product_id, variant_id, branch_id, type, quantity, note, created_by, order_id)
      VALUES (b_id, it.product_id, it.variant_id, o.branch_id, 'in', it.quantity,
              'Cancelación de la venta Nº ' || o.number, auth.uid(), o.id);
    END IF;
  END LOOP;

  UPDATE orders
     SET cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = COALESCE(btrim(p_reason), '')
   WHERE id = o.id
   RETURNING * INTO o;
  RETURN o;
END $function$;

CREATE OR REPLACE FUNCTION public.get_public_catalog(p_business uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.active AND (CASE WHEN p.track_stock THEN v.stock > 0
                        ELSE NOT EXISTS (SELECT 1 FROM variant_stock vs WHERE vs.variant_id = v.id AND vs.branch_id IN (SELECT id FROM branches WHERE business_id = p.business_id AND active))
                          OR EXISTS (SELECT 1 FROM variant_stock vs JOIN branches br ON br.id = vs.branch_id AND br.active WHERE vs.variant_id = v.id AND vs.available) END)
          ),
          'variants', (
            SELECT jsonb_agg(jsonb_build_object(
                     'id', v.id,
                     'attributes', v.attributes,
                     'price', v.price,
                     'available', (CASE WHEN p.track_stock THEN v.stock > 0
                        ELSE NOT EXISTS (SELECT 1 FROM variant_stock vs WHERE vs.variant_id = v.id AND vs.branch_id IN (SELECT id FROM branches WHERE business_id = p.business_id AND active))
                          OR EXISTS (SELECT 1 FROM variant_stock vs JOIN branches br ON br.id = vs.branch_id AND br.active WHERE vs.variant_id = v.id AND vs.available) END)
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
END $function$;
