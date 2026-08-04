/*
# Cuentas bancarias (control financiero por cuenta)

Reorganiza los pagos alrededor de CUENTAS BANCARIAS para saber exactamente
cuánto entra a cada cuenta:

- bank_accounts: cuenta del negocio (nombre, moneda Bs/USD, saldo inicial). El
  ingreso a cada cuenta se calcula sumando los pagos ligados a ella.
- payment_methods gana account_id + description: ahora un método pertenece a una
  cuenta (p. ej. cuenta "Banesco Bs" con métodos "Transferencia" y "Pago móvil").
  Si una cuenta no tiene métodos, la cuenta misma se usa como método.
- order_payments gana account_id + account_name (snapshot): cada pago queda
  ligado a su cuenta para reportar ingresos por cuenta, aun si la cuenta se
  renombra o borra después.

Migración de datos: cada método existente se convierte en una CUENTA propia
(sin submétodos) y los pagos históricos se reetiquetan a esa cuenta. Así el
historial de ventas y los reportes por cuenta quedan consistentes.

Los saldos reales (entradas − salidas) requieren un módulo de gastos/retiros que
queda para una fase posterior; por ahora se reporta el INGRESO por cuenta y,
opcionalmente, un saldo inicial declarado por el usuario.
*/

-- ---------- Tabla de cuentas ----------
CREATE TABLE IF NOT EXISTS bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'VES' CHECK (currency IN ('USD', 'VES')),
  opening_balance numeric(18,2) NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}',      -- banco, titular, nº de cuenta, etc.
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_business ON bank_accounts (business_id, sort_order);

-- ---------- payment_methods: pertenece a una cuenta + descripción ----------
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES bank_accounts(id) ON DELETE CASCADE;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

-- ---------- order_payments: ligado a la cuenta (snapshot del nombre) ----------
ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS account_name text NOT NULL DEFAULT '';

-- ---------- Migración: cada método existente → una cuenta propia ----------
DO $$
DECLARE pm record; acc uuid;
BEGIN
  FOR pm IN SELECT * FROM payment_methods LOOP
    INSERT INTO bank_accounts (business_id, name, currency, sort_order, active)
    VALUES (pm.business_id, pm.name, pm.currency, pm.sort_order, pm.active)
    RETURNING id INTO acc;
    UPDATE order_payments SET account_id = acc, account_name = pm.name WHERE method_id = pm.id;
  END LOOP;
END $$;

-- Los métodos existentes ya son cuentas: se eliminan como métodos (los pagos
-- históricos conservan method_name como snapshot y quedan ligados a la cuenta).
DELETE FROM payment_methods;

-- ---------- RLS de cuentas (CRUD del propio negocio) ----------
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_accounts_select ON bank_accounts FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
CREATE POLICY bank_accounts_insert ON bank_accounts FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());
CREATE POLICY bank_accounts_update ON bank_accounts FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY bank_accounts_delete ON bank_accounts FOR DELETE TO authenticated
  USING (business_id = public.current_business_id());

-- ---------- Seed de negocios nuevos: dos cuentas por defecto ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'business_name', '') <> '' THEN
    INSERT INTO businesses (name, business_type)
    VALUES (NEW.raw_user_meta_data->>'business_name',
            COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_type', ''), 'general'))
    RETURNING id INTO b_id;
    INSERT INTO bank_accounts (business_id, name, currency, sort_order) VALUES
      (b_id, 'Pago móvil', 'VES', 0),
      (b_id, 'Dólares', 'USD', 1);
  END IF;
  INSERT INTO profiles (id, business_id, full_name, email)
  VALUES (NEW.id, b_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), COALESCE(NEW.email, ''));
  RETURN NEW;
END $$;

-- ---------- create_order(): pagos ligados a cuenta (y método opcional) ----------
-- Igual que la versión con descuento por divisa, pero cada pago resuelve su
-- cuenta (moneda y nombre desde el servidor) y guarda account_id/account_name.
CREATE OR REPLACE FUNCTION public.create_order(
  p_items jsonb, p_payments jsonb, p_rate numeric, p_rate_source text,
  p_customer_name text, p_note text, p_customer_id uuid DEFAULT NULL
) RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
  o orders%ROWTYPE;
  prod products%ROWTYPE;
  var product_variants%ROWTYPE;
  cust customers%ROWTYPE;
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

  INSERT INTO orders (business_id, number, customer_id, customer_name, note, rate, rate_source, created_by)
  VALUES (b.id, lpad(seq::text, 6, '0'), p_customer_id, v_name, COALESCE(p_note, ''),
          p_rate, COALESCE(NULLIF(p_rate_source, ''), 'bcv_usd'), auth.uid())
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
                             unit, quantity, unit_price_usd, line_total_usd)
    VALUES (o.id, prod.id, var.id, prod.name, COALESCE(v_label, ''),
            prod.unit, qty, unit_price, line_total);

    INSERT INTO inventory_movements (business_id, product_id, variant_id, type, quantity, note, created_by, order_id)
    VALUES (b.id, prod.id, var.id, 'out', qty, 'Pedido ' || o.number, auth.uid(), o.id);
  END LOOP;

  IF p_payments IS NOT NULL THEN
    FOR pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      pay_amount := COALESCE(NULLIF(pay->>'amount', '')::numeric, 0);
      IF pay_amount <= 0 THEN CONTINUE; END IF;

      -- Resuelve método (opcional) y cuenta. La moneda sale de la cuenta/método
      -- del servidor, no del cliente, para no romper el cuadre.
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

GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, numeric, text, text, text, uuid) TO authenticated;
