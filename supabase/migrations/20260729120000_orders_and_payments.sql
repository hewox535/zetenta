/*
# Módulo de Pedidos (POS), métodos de pago, tasa de cambio y estadísticas

Añade sobre el esquema de la plataforma:

- payment_methods: métodos de pago por negocio. Cada negocio nace con
  "Pago móvil" (VES) y "Dólares" (USD). El dueño los gestiona (CRUD directo
  con RLS, como suppliers/products).
- orders + order_items + order_payments: pedidos del POS. Creados por la RPC
  create_order() para numeración atómica y snapshot de precios/tasa. Cada
  pedido congela la tasa (rate) usada para que los reportes históricos no
  cambien cuando el BCV cambie. Soporta pago mixto (varias filas en
  order_payments, posibles monedas distintas).
- businesses gana order_seq (numeración de pedidos) y rate_config (cómo se
  calcula el bolívar: BCV USD/EUR o tasa manual). capabilities gana los
  módulos "orders" y "stats".
- inventory_movements gana order_id: los pedidos descuentan stock generando
  un movimiento de salida ligado al pedido. Se permite vender sin stock
  (sobreventa) SOLO cuando el movimiento viene de un pedido; las salidas
  manuales de inventario siguen bloqueando stock negativo.
*/

-- ---------- businesses: nuevas columnas y capabilities ----------
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS order_seq integer NOT NULL DEFAULT 1;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS rate_config jsonb NOT NULL
  DEFAULT '{"mode":"bcv","currency":"USD"}';

-- Los negocios existentes obtienen los módulos nuevos; el nuevo default los trae
UPDATE businesses SET capabilities = capabilities || '{"orders":true,"stats":true}'::jsonb;
ALTER TABLE businesses ALTER COLUMN capabilities
  SET DEFAULT '{"retentions": true, "inventory": true, "orders": true, "stats": true}';

-- ---------- Métodos de pago ----------
CREATE TABLE payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'VES' CHECK (currency IN ('USD', 'VES')),
  details jsonb NOT NULL DEFAULT '{}',   -- p. ej. Pago móvil: {bank, phone, id}
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payment_methods_business ON payment_methods (business_id, sort_order);

-- ---------- Pedidos ----------
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  number text NOT NULL,
  customer_name text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  rate numeric(18,6) NOT NULL,               -- bolívares por 1 USD al momento de la venta
  rate_source text NOT NULL DEFAULT 'bcv_usd',
  total_usd numeric(14,2) NOT NULL DEFAULT 0,
  total_ves numeric(18,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, number)
);
CREATE INDEX idx_orders_business ON orders (business_id, created_at DESC);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'und',
  quantity numeric(14,2) NOT NULL,
  unit_price_usd numeric(14,2) NOT NULL,
  line_total_usd numeric(14,2) NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_order_items_product ON order_items (product_id);

CREATE TABLE order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  method_name text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('USD', 'VES')),
  amount numeric(18,2) NOT NULL,             -- en la moneda del método
  amount_usd numeric(14,2) NOT NULL          -- normalizado para reportes
);
CREATE INDEX idx_order_payments_order ON order_payments (order_id);

-- ---------- Inventario: enlaza movimiento con pedido y permite sobreventa ----------
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS order_id uuid
  REFERENCES orders(id) ON DELETE SET NULL;

-- Reemplaza el trigger: la sobreventa (stock negativo) solo se permite si el
-- movimiento proviene de un pedido; las salidas manuales siguen bloqueando.
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_stock numeric;
BEGIN
  IF NEW.type = 'in' THEN
    UPDATE products SET stock = stock + NEW.quantity WHERE id = NEW.product_id RETURNING stock INTO new_stock;
  ELSIF NEW.type = 'out' THEN
    UPDATE products SET stock = stock - NEW.quantity WHERE id = NEW.product_id RETURNING stock INTO new_stock;
  ELSE
    UPDATE products SET stock = NEW.quantity WHERE id = NEW.product_id RETURNING stock INTO new_stock;
  END IF;
  IF new_stock IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF new_stock < 0 AND NEW.order_id IS NULL THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
  RETURN NEW;
END $$;

-- ---------- Seed de métodos de pago (negocios existentes) ----------
INSERT INTO payment_methods (business_id, name, currency, sort_order)
SELECT id, 'Pago móvil', 'VES', 0 FROM businesses
UNION ALL
SELECT id, 'Dólares', 'USD', 1 FROM businesses;

-- ---------- Signup: crear negocio + perfil + métodos de pago por defecto ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'business_name', '') <> '' THEN
    INSERT INTO businesses (name) VALUES (NEW.raw_user_meta_data->>'business_name')
    RETURNING id INTO b_id;
    INSERT INTO payment_methods (business_id, name, currency, sort_order) VALUES
      (b_id, 'Pago móvil', 'VES', 0),
      (b_id, 'Dólares', 'USD', 1);
  END IF;
  INSERT INTO profiles (id, business_id, full_name, email)
  VALUES (NEW.id, b_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), COALESCE(NEW.email, ''));
  RETURN NEW;
END $$;

-- ---------- Ajustes del negocio editables por el dueño (tasa de cambio) ----------
CREATE OR REPLACE FUNCTION public.update_order_settings(p_rate_config jsonb)
RETURNS businesses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
BEGIN
  UPDATE businesses SET rate_config = p_rate_config
   WHERE id = public.current_business_id()
   RETURNING * INTO b;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  RETURN b;
END $$;

-- ---------- Creación de pedido con numeración atómica y snapshot ----------
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
  total_usd numeric := 0;
  paid_usd numeric := 0;
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

  -- Ítems: el precio se toma del producto en el servidor (no se confía en el cliente)
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO prod FROM products WHERE id = (it->>'product_id')::uuid AND business_id = b.id;
    IF prod.id IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
    qty := COALESCE(NULLIF(it->>'quantity', '')::numeric, 0);
    IF qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
    line_total := round(prod.price * qty, 2);
    total_usd := total_usd + line_total;

    INSERT INTO order_items (order_id, product_id, name, unit, quantity, unit_price_usd, line_total_usd)
    VALUES (o.id, prod.id, prod.name, prod.unit, qty, prod.price, line_total);

    -- Descuenta stock generando una salida ligada al pedido (permite sobreventa)
    INSERT INTO inventory_movements (business_id, product_id, type, quantity, note, created_by, order_id)
    VALUES (b.id, prod.id, 'out', qty, 'Pedido ' || o.number, auth.uid(), o.id);
  END LOOP;

  -- Pagos (posiblemente mixtos / varias monedas)
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
      paid_usd := paid_usd + pay_amount_usd;
      INSERT INTO order_payments (order_id, method_id, method_name, currency, amount, amount_usd)
      VALUES (o.id, pm.id, COALESCE(pm.name, pay->>'method_name', 'Pago'),
              COALESCE(NULLIF(pay->>'currency', ''), 'VES'), pay_amount, pay_amount_usd);
    END LOOP;
  END IF;

  IF paid_usd + 0.01 < total_usd THEN
    RAISE EXCEPTION 'Payments (%) do not cover the order total (%)', round(paid_usd, 2), round(total_usd, 2);
  END IF;

  UPDATE orders SET total_usd = total_usd, total_ves = round(total_usd * p_rate, 2)
   WHERE id = o.id RETURNING * INTO o;
  RETURN o;
END $$;

-- ---------- RLS ----------
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_payments ENABLE ROW LEVEL SECURITY;

-- payment_methods: CRUD del propio negocio
CREATE POLICY payment_methods_select ON payment_methods FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
CREATE POLICY payment_methods_insert ON payment_methods FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());
CREATE POLICY payment_methods_update ON payment_methods FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY payment_methods_delete ON payment_methods FOR DELETE TO authenticated
  USING (business_id = public.current_business_id());

-- orders (insert va por la RPC; select/delete directos)
CREATE POLICY orders_select ON orders FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
CREATE POLICY orders_delete ON orders FOR DELETE TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY order_items_select ON order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM orders o WHERE o.id = order_id
      AND (o.business_id = public.current_business_id() OR public.is_platform_admin())
  ));

CREATE POLICY order_payments_select ON order_payments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM orders o WHERE o.id = order_id
      AND (o.business_id = public.current_business_id() OR public.is_platform_admin())
  ));

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION public.update_order_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, numeric, text, text, text) TO authenticated;
