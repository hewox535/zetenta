/*
# Fix: create_order() — variables locales colisionaban con columnas

Las variables total_usd/paid_usd tenían el mismo nombre que columnas de orders,
lo que hacía ambigua la referencia en el UPDATE final
("column reference \"total_usd\" is ambiguous"). Se renombran con prefijo v_.
*/

CREATE OR REPLACE FUNCTION public.create_order(
  p_items jsonb, p_payments jsonb, p_rate numeric, p_rate_source text,
  p_customer_name text, p_note text
) RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
  o orders%ROWTYPE;
  prod products%ROWTYPE;
  it jsonb;
  pay jsonb;
  seq integer;
  qty numeric;
  line_total numeric;
  v_total numeric := 0;
  v_paid numeric := 0;
  pay_amount numeric;
  pay_amount_usd numeric;
  pm payment_methods%ROWTYPE;
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

  seq := b.order_seq;
  UPDATE businesses SET order_seq = order_seq + 1 WHERE id = b.id;

  INSERT INTO orders (business_id, number, customer_name, note, rate, rate_source, created_by)
  VALUES (b.id, lpad(seq::text, 6, '0'), COALESCE(p_customer_name, ''), COALESCE(p_note, ''),
          p_rate, COALESCE(NULLIF(p_rate_source, ''), 'bcv_usd'), auth.uid())
  RETURNING * INTO o;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO prod FROM products WHERE id = (it->>'product_id')::uuid AND business_id = b.id;
    IF prod.id IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
    qty := COALESCE(NULLIF(it->>'quantity', '')::numeric, 0);
    IF qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
    line_total := round(prod.price * qty, 2);
    v_total := v_total + line_total;

    INSERT INTO order_items (order_id, product_id, name, unit, quantity, unit_price_usd, line_total_usd)
    VALUES (o.id, prod.id, prod.name, prod.unit, qty, prod.price, line_total);

    INSERT INTO inventory_movements (business_id, product_id, type, quantity, note, created_by, order_id)
    VALUES (b.id, prod.id, 'out', qty, 'Pedido ' || o.number, auth.uid(), o.id);
  END LOOP;

  IF p_payments IS NOT NULL THEN
    FOR pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      pay_amount := COALESCE(NULLIF(pay->>'amount', '')::numeric, 0);
      IF pay_amount <= 0 THEN CONTINUE; END IF;
      pm := NULL;
      IF NULLIF(pay->>'method_id', '') IS NOT NULL THEN
        SELECT * INTO pm FROM payment_methods WHERE id = (pay->>'method_id')::uuid AND business_id = b.id;
      END IF;
      IF (pay->>'currency') = 'USD' THEN
        pay_amount_usd := pay_amount;
      ELSE
        pay_amount_usd := round(pay_amount / p_rate, 2);
      END IF;
      v_paid := v_paid + pay_amount_usd;
      INSERT INTO order_payments (order_id, method_id, method_name, currency, amount, amount_usd)
      VALUES (o.id, pm.id, COALESCE(pm.name, pay->>'method_name', 'Pago'),
              COALESCE(NULLIF(pay->>'currency', ''), 'VES'), pay_amount, pay_amount_usd);
    END LOOP;
  END IF;

  IF v_paid + 0.01 < v_total THEN
    RAISE EXCEPTION 'Payments (%) do not cover the order total (%)', round(v_paid, 2), round(v_total, 2);
  END IF;

  UPDATE orders SET total_usd = v_total, total_ves = round(v_total * p_rate, 2)
   WHERE id = o.id RETURNING * INTO o;
  RETURN o;
END $$;
