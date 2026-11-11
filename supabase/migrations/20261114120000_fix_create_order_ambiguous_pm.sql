/*
# Arreglo: "column reference \"pm.id\" is ambiguous" al finalizar ventas

La detección de Cashea (20261111120000) usaba el alias "pm" para
payment_methods, pero create_order ya tiene una variable "pm"; Postgres no
sabía a cuál se refería y toda venta fallaba. Se renombra el alias a "cm".
*/

CREATE OR REPLACE FUNCTION public.create_order(
  p_items jsonb, p_payments jsonb, p_rate numeric, p_rate_source text,
  p_customer_name text, p_note text, p_customer_id uuid DEFAULT NULL, p_branch_id uuid DEFAULT NULL,
  p_credit_due date DEFAULT NULL,
  p_foreign_discount numeric DEFAULT NULL, p_local_discount numeric DEFAULT NULL
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
  v_credit numeric := 0;
  dv numeric := 0;
  v_list numeric := 0;
  has_cashea boolean := false;
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

  -- Cashea elegido en la venta (aunque llegue sin monto): sin descuentos de contado.
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_payments, '[]'::jsonb)) x
      JOIN payment_methods cm ON cm.id = NULLIF(x->>'method_id', '')::uuid AND cm.business_id = b.id
     WHERE cm.kind = 'cashea'
  ) INTO has_cashea;

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

  -- Lo que no cubre Cashea se liquida primero con bolívares y luego con
  -- divisa. Cada pago "rinde" amt / (1 − su descuento); el descuento
  -- concedido es lo que rindió de más, sin pasar del saldo que cubre.
  pending := v_total - v_list;
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

  IF covered + 0.01 < v_total THEN
    -- Venta a crédito: lo que no se cobró queda como cuenta por cobrar del
    -- cliente. Sin cliente o sin fecha de vencimiento no se puede fiar.
    IF p_credit_due IS NULL THEN
      RAISE EXCEPTION 'Payments (%) do not cover the order total (%)', round(covered, 2), round(v_total, 2);
    END IF;
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'Para vender a crédito hay que elegir el cliente';
    END IF;
    v_credit := round(v_total - covered, 2);
  END IF;

  UPDATE orders SET total_usd = v_total, total_ves = round(v_total * p_rate, 2), discount_usd = v_disc,
                    credit_usd = v_credit
   WHERE id = o.id RETURNING * INTO o;

  IF v_credit > 0 THEN
    INSERT INTO debts (business_id, branch_id, kind, party_type, customer_id, party_name,
                       concept, amount_usd, issue_date, due_date, order_id, created_by)
    VALUES (b.id, br, 'receivable', 'customer', p_customer_id, v_name,
            'Venta Nº ' || o.number, v_credit, current_date, p_credit_due, o.id, auth.uid());
  END IF;
  RETURN o;
END $$;
