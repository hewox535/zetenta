/*
# Variantes de producto

`products` pasa a ser el modelo/artículo padre; `product_variants` guarda cada
combinación de atributos (Color, Talla, …) con su propio SKU y stock. El
inventario se mueve SIEMPRE a nivel de variante (estrategia uniforme):

- product_variants: una variante por (product_id, attributes jsonb). price NULL
  hereda de products.price. El stock vive aquí.
- products.variant_axes: nombres de los ejes por los que varía el modelo
  (p. ej. {'Color','Talla'}); vacío = producto simple (una sola variante).
- inventory_movements.variant_id y order_items.variant_id: el stock y las
  ventas se descuentan de la variante. El trigger apply_inventory_movement
  actualiza product_variants.stock y recalcula products.stock como la suma de
  sus variantes (así la UI que aún lee products.stock sigue funcionando).
- Backfill: cada producto existente recibe una variante por defecto
  (attributes '{}') que hereda su stock/sku/price actuales; los movimientos y
  order_items históricos se re-apuntan a ella.
- create_order() se reescribe para recibir variant_id por ítem y descontar la
  variante correspondiente.

RLS: mismas reglas del resto de la plataforma.
*/

-- ---------- Tabla de variantes ----------
CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL DEFAULT '',
  price numeric(14,2),                     -- NULL = hereda products.price
  stock numeric(14,2) NOT NULL DEFAULT 0,
  attributes jsonb NOT NULL DEFAULT '{}',  -- {"Color":"Azul","Talla":"M"}
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, attributes)          -- no dos variantes con el mismo combo
);
CREATE INDEX idx_variants_business ON product_variants (business_id);
CREATE INDEX idx_variants_product ON product_variants (product_id);

-- ---------- Ejes de variación del modelo ----------
ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_axes text[] NOT NULL DEFAULT '{}';

-- ---------- Enlaces a variante (nullable durante el backfill) ----------
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS variant_id uuid
  REFERENCES product_variants(id) ON DELETE CASCADE;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id uuid
  REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_label text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_movements_variant ON inventory_movements (variant_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant ON order_items (variant_id);

-- ---------- Backfill: variante por defecto por producto ----------
-- price NULL en la variante = hereda products.price (el precio actual).
INSERT INTO product_variants (business_id, product_id, sku, price, stock, attributes)
SELECT p.business_id, p.id, p.sku, NULL, p.stock, '{}'::jsonb
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id);

-- Re-apunta el histórico a la variante por defecto de cada producto.
UPDATE inventory_movements m
   SET variant_id = v.id
  FROM product_variants v
 WHERE v.product_id = m.product_id
   AND v.attributes = '{}'::jsonb
   AND m.variant_id IS NULL;

UPDATE order_items i
   SET variant_id = v.id
  FROM product_variants v
 WHERE v.product_id = i.product_id
   AND v.attributes = '{}'::jsonb
   AND i.variant_id IS NULL;

-- Todo movimiento pertenece a una variante de aquí en adelante.
ALTER TABLE inventory_movements ALTER COLUMN variant_id SET NOT NULL;

-- ---------- Trigger: el stock vive en la variante; products.stock = suma ----------
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_stock numeric;
BEGIN
  IF NEW.type = 'in' THEN
    UPDATE product_variants SET stock = stock + NEW.quantity
      WHERE id = NEW.variant_id RETURNING stock INTO new_stock;
  ELSIF NEW.type = 'out' THEN
    UPDATE product_variants SET stock = stock - NEW.quantity
      WHERE id = NEW.variant_id RETURNING stock INTO new_stock;
  ELSE
    UPDATE product_variants SET stock = NEW.quantity
      WHERE id = NEW.variant_id RETURNING stock INTO new_stock;
  END IF;
  IF new_stock IS NULL THEN RAISE EXCEPTION 'Variant not found'; END IF;
  -- Sobreventa (stock negativo) solo si el movimiento viene de un pedido.
  IF new_stock < 0 AND NEW.order_id IS NULL THEN RAISE EXCEPTION 'Insufficient stock'; END IF;

  UPDATE products SET stock = COALESCE(
    (SELECT sum(stock) FROM product_variants WHERE product_id = NEW.product_id), 0)
   WHERE id = NEW.product_id;
  RETURN NEW;
END $$;

-- ---------- create_order(): ítems por variante ----------
-- p_items: [{ variant_id, quantity }]  (product_id se deriva de la variante)
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
  v_paid numeric := 0;
  v_name text;
  v_label text;
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

    -- Etiqueta legible de la variante ("Azul · M"), vacía en productos simples.
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

-- ---------- RLS ----------
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY variants_select ON product_variants FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
CREATE POLICY variants_insert ON product_variants FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id()
    AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.business_id = public.current_business_id()));
CREATE POLICY variants_update ON product_variants FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());
CREATE POLICY variants_delete ON product_variants FOR DELETE TO authenticated
  USING (business_id = public.current_business_id());

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, numeric, text, text, text, uuid) TO authenticated;
