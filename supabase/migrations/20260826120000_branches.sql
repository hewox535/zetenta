/*
# Multi-sucursal (base de datos)

Introduce sucursales y stock por sucursal, de forma COMPATIBLE hacia atrás:

- branches: sucursales del negocio. Cada negocio recibe una "Principal" por
  defecto (is_default).
- variant_stock: stock por (variante, sucursal). Es la nueva fuente de verdad
  del stock físico por ubicación.
- product_variants.stock y products.stock se conservan como el TOTAL CONSOLIDADO
  (suma de todas las sucursales), mantenido por el trigger. Así toda la UI actual
  que lee esos campos sigue mostrando el total sin cambios.
- inventory_movements.branch_id y orders.branch_id: cada movimiento/venta queda
  ligado a su sucursal (backfill a la Principal). Un trigger BEFORE completa la
  sucursal por defecto si el movimiento no la trae.
- Acceso por usuario: profiles.all_branches (default true, no rompe a nadie) +
  user_branches para permisos específicos. Un usuario con all_branches ve todas;
  si no, solo las de user_branches.
- transfer_stock(): traslado atómico entre sucursales (salida en origen + entrada
  en destino); el origen no puede quedar negativo (no es una venta).

create_order() gana p_branch_id OPCIONAL: si no llega, usa la sucursal por
defecto, para que el POS actual siga funcionando hasta que envíe la sucursal.
*/

-- ---------- Sucursales ----------
CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_branches_business ON branches (business_id, sort_order);

-- Una sucursal "Principal" por negocio existente.
INSERT INTO branches (business_id, name, is_default, sort_order)
SELECT id, 'Principal', true, 0 FROM businesses;

-- ---------- Stock por sucursal ----------
CREATE TABLE IF NOT EXISTS variant_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  stock numeric(14,2) NOT NULL DEFAULT 0,
  UNIQUE (variant_id, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_variant_stock_variant ON variant_stock (variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_stock_branch ON variant_stock (branch_id);

-- Migra el stock actual de cada variante a la sucursal Principal.
INSERT INTO variant_stock (business_id, variant_id, branch_id, stock)
SELECT pv.business_id, pv.id, b.id, pv.stock
FROM product_variants pv
JOIN branches b ON b.business_id = pv.business_id AND b.is_default;

-- ---------- Enlaces de sucursal en movimientos y ventas ----------
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;

UPDATE inventory_movements im SET branch_id = b.id
  FROM branches b WHERE b.business_id = im.business_id AND b.is_default AND im.branch_id IS NULL;
UPDATE orders o SET branch_id = b.id
  FROM branches b WHERE b.business_id = o.business_id AND b.is_default AND o.branch_id IS NULL;

-- ---------- Acceso por usuario ----------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS all_branches boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS user_branches (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, branch_id)
);

-- ---------- Helper: sucursal por defecto del negocio ----------
CREATE OR REPLACE FUNCTION public.default_branch_id(p_business uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM branches WHERE business_id = p_business
   ORDER BY is_default DESC, sort_order, created_at LIMIT 1;
$$;

-- ---------- Trigger BEFORE: completa la sucursal del movimiento ----------
CREATE OR REPLACE FUNCTION public.set_movement_branch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    NEW.branch_id := public.default_branch_id(NEW.business_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS before_inventory_movement ON inventory_movements;
CREATE TRIGGER before_inventory_movement
  BEFORE INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.set_movement_branch();

-- ---------- Trigger AFTER: aplica el stock por sucursal y recalcula totales ----------
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_stock numeric;
BEGIN
  INSERT INTO variant_stock (business_id, variant_id, branch_id, stock)
    VALUES (NEW.business_id, NEW.variant_id, NEW.branch_id, 0)
    ON CONFLICT (variant_id, branch_id) DO NOTHING;

  IF NEW.type = 'in' THEN
    UPDATE variant_stock SET stock = stock + NEW.quantity
      WHERE variant_id = NEW.variant_id AND branch_id = NEW.branch_id RETURNING stock INTO new_stock;
  ELSIF NEW.type = 'out' THEN
    UPDATE variant_stock SET stock = stock - NEW.quantity
      WHERE variant_id = NEW.variant_id AND branch_id = NEW.branch_id RETURNING stock INTO new_stock;
  ELSE
    UPDATE variant_stock SET stock = NEW.quantity
      WHERE variant_id = NEW.variant_id AND branch_id = NEW.branch_id RETURNING stock INTO new_stock;
  END IF;
  IF new_stock IS NULL THEN RAISE EXCEPTION 'Variant not found'; END IF;
  -- Sobreventa (negativo) solo si el movimiento viene de un pedido.
  IF new_stock < 0 AND NEW.order_id IS NULL THEN RAISE EXCEPTION 'Insufficient stock'; END IF;

  -- Totales consolidados (lo que lee la UI actual).
  UPDATE product_variants SET stock = COALESCE(
    (SELECT sum(stock) FROM variant_stock WHERE variant_id = NEW.variant_id), 0)
   WHERE id = NEW.variant_id;
  UPDATE products SET stock = COALESCE(
    (SELECT sum(vs.stock) FROM variant_stock vs
       JOIN product_variants pv ON pv.id = vs.variant_id
      WHERE pv.product_id = NEW.product_id), 0)
   WHERE id = NEW.product_id;
  RETURN NEW;
END $$;

-- ---------- Traslado entre sucursales ----------
CREATE OR REPLACE FUNCTION public.transfer_stock(
  p_variant_id uuid, p_from uuid, p_to uuid, p_qty numeric, p_note text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bid uuid := public.current_business_id();
  prod uuid;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'Origen y destino no pueden ser la misma sucursal'; END IF;
  SELECT product_id INTO prod FROM product_variants WHERE id = p_variant_id AND business_id = bid;
  IF prod IS NULL THEN RAISE EXCEPTION 'Variant not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_from AND business_id = bid) THEN RAISE EXCEPTION 'Origen no válido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_to AND business_id = bid) THEN RAISE EXCEPTION 'Destino no válido'; END IF;

  INSERT INTO inventory_movements (business_id, product_id, variant_id, branch_id, type, quantity, note, created_by)
    VALUES (bid, prod, p_variant_id, p_from, 'out', p_qty, COALESCE(NULLIF(p_note, ''), 'Traslado'), auth.uid());
  INSERT INTO inventory_movements (business_id, product_id, variant_id, branch_id, type, quantity, note, created_by)
    VALUES (bid, prod, p_variant_id, p_to, 'in', p_qty, COALESCE(NULLIF(p_note, ''), 'Traslado'), auth.uid());
END $$;

-- ---------- RLS ----------
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY branches_select ON branches FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
CREATE POLICY branches_insert ON branches FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id() AND public.is_business_admin());
CREATE POLICY branches_update ON branches FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id() AND public.is_business_admin())
  WITH CHECK (business_id = public.current_business_id());
CREATE POLICY branches_delete ON branches FOR DELETE TO authenticated
  USING (business_id = public.current_business_id() AND public.is_business_admin());

ALTER TABLE variant_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_stock_select ON variant_stock FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());

ALTER TABLE user_branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_branches_select ON user_branches FOR SELECT TO authenticated
  USING (user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM branches b WHERE b.id = branch_id AND b.business_id = public.current_business_id() AND public.is_business_admin()));
CREATE POLICY user_branches_write ON user_branches FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM branches b WHERE b.id = branch_id AND b.business_id = public.current_business_id() AND public.is_business_admin()))
  WITH CHECK (EXISTS (SELECT 1 FROM branches b WHERE b.id = branch_id AND b.business_id = public.current_business_id() AND public.is_business_admin()));

GRANT EXECUTE ON FUNCTION public.default_branch_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_stock(uuid, uuid, uuid, numeric, text) TO authenticated;

-- ---------- Seed de negocios nuevos: sucursal Principal ----------
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
    INSERT INTO branches (business_id, name, is_default, sort_order)
      VALUES (b_id, 'Principal', true, 0);
  END IF;
  INSERT INTO profiles (id, business_id, full_name, email)
  VALUES (NEW.id, b_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), COALESCE(NEW.email, ''));
  RETURN NEW;
END $$;

-- ---------- create_order(): sucursal opcional (default a la Principal) ----------
-- Elimina firmas previas para que la llamada de 7 args (sin sucursal) resuelva
-- sin ambigüedad a esta versión de 8 args (p_branch_id con default).
DROP FUNCTION IF EXISTS public.create_order(jsonb, jsonb, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.create_order(jsonb, jsonb, numeric, text, text, text, uuid);

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
                             unit, quantity, unit_price_usd, line_total_usd)
    VALUES (o.id, prod.id, var.id, prod.name, COALESCE(v_label, ''),
            prod.unit, qty, unit_price, line_total);

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

GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, numeric, text, text, text, uuid, uuid) TO authenticated;
