/*
# Descuento por divisa, roles de negocio y umbral de stock bajo

Puntos 2, 3 y 5 del plan:

2) Descuento por pago en divisa
   - businesses.foreign_discount_percent: % de descuento que se aplica SOLO a la
     porción del pedido que se paga en divisa (USD), nunca a la parte en bolívares.
   - orders.discount_usd: descuento concedido en el pedido (informativo/reportes).
   - create_order() aplica el descuento sobre el saldo pendiente pagado en divisa:
     el saldo tras los pagos en Bs se liquida en USD con (1 - d); el descuento
     queda registrado y la cobertura del total lo contempla.

3) Roles de negocio
   - profiles.business_role: 'admin' (acceso completo) | 'seller' (solo ventas).
     Los perfiles de negocio existentes quedan como 'admin' (dueños).
   - Un negocio puede tener varios usuarios (el admin crea vendedoras vía la
     Edge Function `staff`, que corre con service role).
   - RLS: los miembros de un negocio pueden leerse entre sí (para auditoría y
     gestión de personal). set_staff_role() permite al admin cambiar el rol
     admin/seller dentro de su negocio (nunca tocar platform_admin).

5) Umbral de stock bajo
   - businesses.low_stock_percent (default 20).
   - product_variants.target_stock: stock objetivo por variante; hay alerta de
     stock bajo cuando stock <= target_stock * low_stock_percent/100.
*/

-- ---------- Columnas nuevas ----------
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS foreign_discount_percent numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS low_stock_percent numeric(5,2) NOT NULL DEFAULT 20;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_usd numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS target_stock numeric(14,2);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS business_role text NOT NULL DEFAULT 'admin'
  CHECK (business_role IN ('admin', 'seller'));

-- ---------- Helpers de rol ----------
CREATE OR REPLACE FUNCTION public.current_business_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT business_role FROM profiles WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.is_business_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
     AND business_id IS NOT NULL AND business_role = 'admin') $$;

-- ---------- RLS: miembros del mismo negocio se pueden leer ----------
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR business_id = public.current_business_id() OR public.is_platform_admin());

-- ---------- Cambiar el rol de un miembro (solo admin del negocio) ----------
CREATE OR REPLACE FUNCTION public.set_staff_role(p_user uuid, p_role text)
RETURNS profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me profiles%ROWTYPE;
  target profiles%ROWTYPE;
BEGIN
  SELECT * INTO me FROM profiles WHERE id = auth.uid();
  IF me.business_id IS NULL OR me.business_role <> 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador del negocio puede cambiar roles';
  END IF;
  IF p_role NOT IN ('admin', 'seller') THEN RAISE EXCEPTION 'Rol inválido'; END IF;
  SELECT * INTO target FROM profiles WHERE id = p_user AND business_id = me.business_id;
  IF target.id IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado en tu negocio'; END IF;
  IF target.role = 'platform_admin' THEN RAISE EXCEPTION 'No se puede cambiar a un administrador de plataforma'; END IF;
  UPDATE profiles SET business_role = p_role WHERE id = p_user RETURNING * INTO target;
  RETURN target;
END $$;

-- ---------- Ajustes de negocio editables por el admin ----------
CREATE OR REPLACE FUNCTION public.update_business_settings(
  p_foreign_discount_percent numeric, p_low_stock_percent numeric
) RETURNS businesses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
BEGIN
  IF NOT public.is_business_admin() THEN
    RAISE EXCEPTION 'Solo un administrador del negocio puede cambiar los ajustes';
  END IF;
  UPDATE businesses SET
    foreign_discount_percent = GREATEST(0, LEAST(100, COALESCE(p_foreign_discount_percent, 0))),
    low_stock_percent = GREATEST(0, LEAST(100, COALESCE(p_low_stock_percent, 20)))
   WHERE id = public.current_business_id()
   RETURNING * INTO b;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  RETURN b;
END $$;

-- ---------- create_order(): descuento por divisa sobre el saldo pendiente ----------
DROP FUNCTION IF EXISTS public.create_order(jsonb, jsonb, numeric, text, text, text, uuid);

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
  v_ves numeric := 0;      -- pagos en Bs, normalizados a USD
  v_usd numeric := 0;      -- pagos en divisa (USD real entregado)
  v_name text;
  v_label text;
  v_disc numeric := 0;
  d numeric := 0;
  pending numeric;
  usd_needed numeric;
  covered numeric;
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
      pm := NULL;
      IF NULLIF(pay->>'method_id', '') IS NOT NULL THEN
        SELECT * INTO pm FROM payment_methods WHERE id = (pay->>'method_id')::uuid AND business_id = b.id;
      END IF;
      IF (pay->>'currency') = 'USD' THEN
        pay_amount_usd := pay_amount;
        v_usd := v_usd + pay_amount;
      ELSE
        pay_amount_usd := round(pay_amount / p_rate, 2);
        v_ves := v_ves + pay_amount_usd;
      END IF;
      INSERT INTO order_payments (order_id, method_id, method_name, currency, amount, amount_usd)
      VALUES (o.id, pm.id, COALESCE(pm.name, pay->>'method_name', 'Pago'),
              COALESCE(NULLIF(pay->>'currency', ''), 'VES'), pay_amount, pay_amount_usd);
    END LOOP;
  END IF;

  -- Descuento por divisa: se aplica al saldo que queda tras los pagos en Bs y
  -- se liquida en divisa. La cobertura del total considera el descuento.
  pending := GREATEST(0, v_total - v_ves);
  usd_needed := round(pending * (1 - d), 2);
  IF v_usd + 0.01 >= usd_needed THEN
    v_disc := round(pending * d, 2);                 -- saldo pendiente liquidado en divisa
  ELSE
    v_disc := round(v_usd * d / (1 - d), 2);         -- divisa parcial
  END IF;
  covered := v_ves + CASE WHEN d > 0 THEN v_usd / (1 - d) ELSE v_usd END;

  IF covered + 0.01 < v_total THEN
    RAISE EXCEPTION 'Payments (%) do not cover the order total (%)', round(covered, 2), round(v_total, 2);
  END IF;

  UPDATE orders SET total_usd = v_total, total_ves = round(v_total * p_rate, 2), discount_usd = v_disc
   WHERE id = o.id RETURNING * INTO o;
  RETURN o;
END $$;

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION public.current_business_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_business_settings(numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, numeric, text, text, text, uuid) TO authenticated;
