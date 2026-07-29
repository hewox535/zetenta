/*
# Módulo de Clientes

- customers: clientes por negocio. Solo el nombre es obligatorio; documento,
  teléfono y correo son opcionales. CRUD directo con RLS, igual que suppliers.
- orders gana customer_id: al crear un pedido se puede elegir un cliente
  existente o crear uno nuevo desde el POS. Se mantiene customer_name como
  snapshot (para históricos y recibos, aunque luego se edite/elimine el cliente).
- Nueva capability "customers" (activa por defecto para negocios existentes y
  nuevos), gestionable por el administrador de la plataforma.
- create_order() recibe p_customer_id: valida que el cliente sea del negocio y,
  si no viene nombre explícito, usa el del cliente como snapshot.
*/

-- ---------- Tabla de clientes ----------
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  document text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_business ON customers (business_id, name);

-- ---------- Pedidos: enlaza con el cliente ----------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id uuid
  REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id);

-- ---------- Capability nueva ----------
UPDATE businesses SET capabilities = capabilities || '{"customers":true}'::jsonb;
ALTER TABLE businesses ALTER COLUMN capabilities
  SET DEFAULT '{"retentions": true, "inventory": true, "orders": true, "stats": true, "customers": true}';

-- ---------- RLS ----------
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_select ON customers FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
CREATE POLICY customers_insert ON customers FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());
CREATE POLICY customers_update ON customers FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY customers_delete ON customers FOR DELETE TO authenticated
  USING (business_id = public.current_business_id());

-- ---------- create_order(): añade p_customer_id ----------
DROP FUNCTION IF EXISTS public.create_order(jsonb, jsonb, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.create_order(
  p_items jsonb, p_payments jsonb, p_rate numeric, p_rate_source text,
  p_customer_name text, p_note text, p_customer_id uuid DEFAULT NULL
) RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
  o orders%ROWTYPE;
  prod products%ROWTYPE;
  cust customers%ROWTYPE;
  it jsonb;
  pay jsonb;
  seq integer;
  qty numeric;
  line_total numeric;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_name text;
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

  -- Cliente (opcional): debe pertenecer al negocio. El nombre snapshot usa el
  -- explícito si viene, si no el del cliente.
  v_name := COALESCE(p_customer_name, '');
  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO cust FROM customers WHERE id = p_customer_id AND business_id = b.id;
    IF cust.id IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
    IF v_name = '' THEN v_name := cust.name; END IF;
  END IF;

  seq := b.order_seq;
  UPDATE businesses SET order_seq = order_seq + 1 WHERE id = b.id;

  INSERT INTO orders (business_id, number, customer_id, customer_name, note, rate, rate_source, created_by)
  VALUES (b.id, lpad(seq::text, 6, '0'), p_customer_id, v_name, COALESCE(p_note, ''),
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

GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, numeric, text, text, text, uuid) TO authenticated;
