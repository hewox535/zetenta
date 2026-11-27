-- IVA e IGTF opcionales en la venta, notas de débito y la facturación como
-- módulo que la administración habilita por negocio (beta: solo Nácar).
--
-- * Cobro: el interruptor «IVA» suma el IVA de cada producto (16 %, 8 % o 0)
--   encima del precio; «IGTF (3 %)» cobra el 3 % sobre lo que se paga en
--   divisas (el pago en dólares lo trae incluido). Igual que la plataforma de
--   referencia. Sin el interruptor de IVA, el precio se toma con IVA incluido
--   y la factura lo separa (como hasta ahora).
-- * orders guarda iva_added, iva_usd (IVA neto del descuento) e igtf_usd.
--   total_usd sigue siendo lo que cuesta la venta para el cliente antes del
--   descuento (con IVA si se sumó); el IGTF va aparte.
-- * capabilities.invoicing: sin ella no se ve ni se puede usar la facturación.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS iva_added boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS iva_usd numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS igtf_usd numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS igtf_base_usd numeric(14,2) NOT NULL DEFAULT 0;  -- lo pagado en divisas sobre lo que se calculó

-- La firma cambia (dos parámetros nuevos): se reemplaza la anterior para no dejar dos versiones.
DROP FUNCTION IF EXISTS public.create_order(jsonb, jsonb, numeric, text, text, text, uuid, uuid, date, numeric, numeric, uuid[], uuid, numeric, text);
CREATE OR REPLACE FUNCTION public.create_order(p_items jsonb, p_payments jsonb, p_rate numeric, p_rate_source text, p_customer_name text, p_note text, p_customer_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid, p_credit_due date DEFAULT NULL::date, p_foreign_discount numeric DEFAULT NULL::numeric, p_local_discount numeric DEFAULT NULL::numeric, p_skip_discounts uuid[] DEFAULT NULL::uuid[], p_discount_id uuid DEFAULT NULL::uuid, p_custom_percent numeric DEFAULT NULL::numeric, p_custom_name text DEFAULT NULL::text, p_add_iva boolean DEFAULT false, p_igtf boolean DEFAULT false)
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
  -- IVA sumado al precio (interruptor «IVA» del cobro) e IGTF sobre lo pagado en divisas.
  r_iva numeric;
  line_due numeric;         -- lo que cuesta la línea para el cliente (con IVA si se suma)
  v_iva_gross numeric := 0;
  v_igtf numeric := 0;
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
    r_iva := COALESCE(prod.iva_rate, 16);
    line_due := CASE WHEN p_add_iva THEN round(line_total * (1 + r_iva / 100.0), 2) ELSE line_total END;
    v_iva_gross := v_iva_gross + (line_due - line_total);
    v_total := v_total + line_due;

    -- Descuento especial: a todo, o solo a los productos de sus categorías.
    line_pct := 0;
    IF promo_pct > 0 AND (cardinality(ds.term_ids) = 0 OR EXISTS (
         SELECT 1 FROM product_terms pt WHERE pt.product_id = prod.id AND pt.term_id = ANY (ds.term_ids))) THEN
      line_pct := promo_pct;
      n_hit := n_hit + 1;
    END IF;
    IF has_cashea THEN
      v_promo := v_promo + round(line_due * line_pct, 2);
    ELSE
      -- De contado no se suma al de la moneda: en cada artículo, el mayor.
      t_ves := t_ves + line_due * (1 - GREATEST(line_pct, dv));
      t_usd := t_usd + line_due * (1 - GREATEST(line_pct, d));
    END IF;

    SELECT string_agg(value, ' · ' ORDER BY key) INTO v_label
      FROM jsonb_each_text(var.attributes);

    INSERT INTO order_items (order_id, product_id, variant_id, name, variant_label,
                             unit, quantity, unit_price_usd, unit_cost_usd, offer_percent, offer_price, line_total_usd, iva_rate)
    VALUES (o.id, prod.id, var.id, prod.name, COALESCE(v_label, ''),
            prod.unit, qty, unit_price, COALESCE(var.cost, prod.cost, 0), offer, offer_fixed, line_total, r_iva);

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
        -- Con IGTF, el pago en divisas trae el 3 % encima: a la venta va lo demás.
        v_usd := v_usd + CASE WHEN p_igtf THEN pay_amount / 1.03 ELSE pay_amount END;
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

  IF p_igtf THEN v_igtf := round(v_usd * 0.03, 2); END IF;

  UPDATE orders SET total_usd = v_total, total_ves = round(v_total * p_rate, 2), discount_usd = v_disc + v_promo,
                    iva_added = p_add_iva,
                    iva_usd = CASE WHEN p_add_iva AND v_total > 0
                                   THEN round(v_iva_gross * (v_total - v_disc - v_promo) / v_total, 2) ELSE 0 END,
                    igtf_usd = v_igtf,
                    igtf_base_usd = CASE WHEN p_igtf THEN round(v_usd, 2) ELSE 0 END,
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
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, numeric, text, text, text, uuid, uuid, date, numeric, numeric, uuid[], uuid, numeric, text, boolean, boolean) TO authenticated;

-- ---------- Facturas: IVA sumado e IGTF ----------
CREATE OR REPLACE FUNCTION public.fiscal_issue_invoice(p_business uuid, p_order uuid, p_customer jsonb, p_actor uuid)
RETURNS invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fp fiscal_profiles;
  o orders;
  inv invoices;
  it record;
  v_rate numeric;
  gross_usd numeric;
  factor numeric;
  lines jsonb := '[]'::jsonb;
  amt numeric; net numeric; base numeric;
  ex numeric := 0; bg numeric := 0; br numeric := 0;
  sub_g numeric := 0; sub_r numeric := 0; sub_e numeric := 0;
  disc numeric := 0;
  n integer;
  cust jsonb;
  biz jsonb;
  igtf_ves numeric := 0;
BEGIN
  SELECT capabilities INTO biz FROM businesses WHERE id = p_business;
  IF NOT COALESCE((biz->>'invoicing')::boolean, false) THEN RAISE EXCEPTION 'La facturación digital no está habilitada para este negocio'; END IF;
  SELECT * INTO fp FROM fiscal_profiles WHERE business_id = p_business FOR UPDATE;
  IF fp IS NULL OR fp.status <> 'active' THEN RAISE EXCEPTION 'La facturación digital no está activa en este negocio'; END IF;
  SELECT * INTO o FROM orders WHERE id = p_order AND business_id = p_business;
  IF o IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF o.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'La venta está anulada'; END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE order_id = p_order AND doc_type = 'factura') THEN
    RAISE EXCEPTION 'Esta venta ya tiene factura';
  END IF;

  cust := jsonb_build_object(
    'name', btrim(COALESCE(p_customer->>'name', '')),
    'document', upper(regexp_replace(btrim(COALESCE(p_customer->>'document', '')), '\s', '', 'g')),
    'address', btrim(COALESCE(p_customer->>'address', '')),
    'phone', btrim(COALESCE(p_customer->>'phone', '')),
    'email', btrim(COALESCE(p_customer->>'email', '')));
  IF cust->>'name' = '' THEN RAISE EXCEPTION 'La factura necesita el nombre o razón social del cliente'; END IF;
  IF cust->>'document' !~ '^[VEJGPC]-?[0-9]{5,9}$' THEN
    RAISE EXCEPTION 'La factura necesita la cédula o RIF del cliente (ej.: V-12345678 o J-123456789)';
  END IF;
  IF cust->>'document' ~ '^[JGC]' AND cust->>'address' = '' THEN
    RAISE EXCEPTION 'Para facturar a una empresa hace falta su domicilio fiscal';
  END IF;

  v_rate := NULLIF(o.rate, 0);
  IF v_rate IS NULL THEN RAISE EXCEPTION 'La venta no tiene tasa de cambio'; END IF;
  -- total_usd ya incluye el IVA si se sumó; el factor del descuento es el mismo.
  gross_usd := COALESCE(o.total_usd, 0);
  IF gross_usd <= 0 THEN RAISE EXCEPTION 'La venta no tiene montos'; END IF;
  factor := GREATEST(0, (gross_usd - COALESCE(o.discount_usd, 0)) / gross_usd);

  FOR it IN SELECT oi.*, COALESCE(oi.iva_rate, 16) AS r, COALESCE(NULLIF(v.sku, ''), p.sku, '') AS code
              FROM order_items oi
              LEFT JOIN product_variants v ON v.id = oi.variant_id
              LEFT JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = p_order ORDER BY oi.id LOOP
    -- Monto sin IVA, antes del descuento: si el IVA se sumó al cobrar, la línea
    -- ya es la base; si no, el precio lo incluía y se separa.
    amt := CASE WHEN o.iva_added THEN round(it.line_total_usd * v_rate, 2)
                ELSE round(it.line_total_usd * v_rate / (1 + it.r / 100), 2) END;
    lines := lines || jsonb_build_object(
      'code', it.code,
      'description', it.name || CASE WHEN COALESCE(it.variant_label, '') <> '' THEN ' · ' || it.variant_label ELSE '' END,
      'quantity', it.quantity,
      'unit', COALESCE(it.unit, 'und'),
      'unit_price_ves', CASE WHEN o.iva_added THEN round(it.unit_price_usd * v_rate, 2)
                             ELSE round(it.unit_price_usd * v_rate / (1 + it.r / 100), 2) END,
      'amount_ves', amt,
      'iva_rate', it.r,
      'tax_code', CASE it.r WHEN 16 THEN 'G' WHEN 8 THEN 'R' ELSE 'E' END,
      'unit_price_usd', it.unit_price_usd,
      'amount_usd', it.line_total_usd);
    IF it.r = 16 THEN sub_g := sub_g + amt; ELSIF it.r = 8 THEN sub_r := sub_r + amt; ELSE sub_e := sub_e + amt; END IF;
  END LOOP;

  bg := round(sub_g * factor, 2);
  br := round(sub_r * factor, 2);
  ex := round(sub_e * factor, 2);
  disc := (sub_g + sub_r + sub_e) - (bg + br + ex);
  igtf_ves := round(COALESCE(o.igtf_usd, 0) * v_rate, 2);

  UPDATE fiscal_profiles SET invoice_seq = invoice_seq + 1 WHERE business_id = p_business RETURNING invoice_seq INTO n;

  INSERT INTO invoices (business_id, branch_id, order_id, doc_type, number, issuer, customer, lines, payments,
                        rate, rate_source, exempt_ves, base_g_ves, iva_g_ves, base_r_ves, iva_r_ves, discount_ves,
                        igtf_base_ves, igtf_ves, total_ves, total_usd, created_by)
  VALUES (p_business, o.branch_id, p_order, 'factura', n,
          jsonb_build_object('legal_name', fp.legal_name, 'rif', fp.rif, 'fiscal_address', fp.fiscal_address,
                             'city', fp.city, 'phone', fp.phone, 'email', fp.email, 'taxpayer_type', fp.taxpayer_type),
          cust, lines,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('method', COALESCE(NULLIF(op.method_name, ''), op.account_name),
                      'currency', op.currency, 'amount', op.amount, 'amount_usd', op.amount_usd, 'kind', op.kind) ORDER BY op.id)
                      FROM order_payments op WHERE op.order_id = p_order), '[]'::jsonb),
          v_rate, COALESCE(o.rate_source, ''), ex, bg, round(bg * 0.16, 2), br, round(br * 0.08, 2), disc,
          CASE WHEN igtf_ves > 0 THEN round(COALESCE(o.igtf_base_usd, 0) * v_rate, 2) ELSE 0 END, igtf_ves,
          ex + bg + round(bg * 0.16, 2) + br + round(br * 0.08, 2) + igtf_ves,
          round(gross_usd - COALESCE(o.discount_usd, 0) + COALESCE(o.igtf_usd, 0), 2), p_actor)
  RETURNING * INTO inv;
  RETURN inv;
END $$;

-- ---------- Notas de débito ----------
-- Cargo adicional sobre una factura (p. ej. un ajuste de precio o un recargo):
-- un concepto con su monto en Bs sin IVA y su alícuota.
CREATE OR REPLACE FUNCTION public.issue_debit_note(p_invoice_id uuid, p_reason text, p_amount_ves numeric, p_iva_rate numeric DEFAULT 16)
RETURNS invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f invoices;
  n integer;
  nd invoices;
  base numeric;
  iva numeric;
BEGIN
  IF NOT public.is_business_admin() THEN RAISE EXCEPTION 'Solo el administrador puede emitir notas de débito'; END IF;
  SELECT * INTO f FROM invoices WHERE id = p_invoice_id AND business_id = public.current_business_id() AND doc_type = 'factura';
  IF f IS NULL THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE related_invoice_id = f.id AND doc_type = 'nota_credito') THEN
    RAISE EXCEPTION 'Esa factura está anulada con nota de crédito';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Indica el concepto de la nota de débito'; END IF;
  IF COALESCE(p_amount_ves, 0) <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor que cero'; END IF;
  IF p_iva_rate NOT IN (0, 8, 16) THEN RAISE EXCEPTION 'Alícuota inválida'; END IF;
  base := round(p_amount_ves, 2);
  iva := round(base * p_iva_rate / 100, 2);
  UPDATE fiscal_profiles SET debit_seq = debit_seq + 1 WHERE business_id = f.business_id RETURNING debit_seq INTO n;
  INSERT INTO invoices (business_id, branch_id, order_id, doc_type, number, related_invoice_id, reason, issuer, customer,
                        lines, rate, rate_source, exempt_ves, base_g_ves, iva_g_ves, base_r_ves, iva_r_ves, total_ves, total_usd, created_by)
  VALUES (f.business_id, f.branch_id, f.order_id, 'nota_debito', n, f.id, btrim(p_reason), f.issuer, f.customer,
          jsonb_build_array(jsonb_build_object('code', '', 'description', btrim(p_reason), 'quantity', 1, 'unit', 'und',
            'unit_price_ves', base, 'amount_ves', base, 'iva_rate', p_iva_rate,
            'tax_code', CASE p_iva_rate WHEN 16 THEN 'G' WHEN 8 THEN 'R' ELSE 'E' END)),
          f.rate, f.rate_source,
          CASE WHEN p_iva_rate = 0 THEN base ELSE 0 END,
          CASE WHEN p_iva_rate = 16 THEN base ELSE 0 END, CASE WHEN p_iva_rate = 16 THEN iva ELSE 0 END,
          CASE WHEN p_iva_rate = 8 THEN base ELSE 0 END, CASE WHEN p_iva_rate = 8 THEN iva ELSE 0 END,
          base + iva, round((base + iva) / NULLIF(f.rate, 0), 2), auth.uid())
  RETURNING * INTO nd;
  RETURN nd;
END $$;
GRANT EXECUTE ON FUNCTION public.issue_debit_note(uuid, text, numeric, numeric) TO authenticated;

-- ---------- La solicitud también exige el módulo ----------
CREATE OR REPLACE FUNCTION public.invoicing_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((capabilities->>'invoicing')::boolean, false) FROM businesses WHERE id = public.current_business_id()
$$;
GRANT EXECUTE ON FUNCTION public.invoicing_enabled() TO authenticated;

CREATE OR REPLACE FUNCTION public.save_fiscal_profile(p jsonb)
RETURNS fiscal_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b uuid := public.current_business_id();
  r fiscal_profiles;
BEGIN
  IF b IS NULL OR NOT public.is_business_admin() THEN RAISE EXCEPTION 'Solo el administrador del negocio puede hacer la solicitud'; END IF;
  IF NOT public.invoicing_enabled() THEN RAISE EXCEPTION 'La facturación digital no está habilitada para este negocio'; END IF;
  INSERT INTO fiscal_profiles (business_id, legal_name, rif, fiscal_address)
  SELECT id, name, COALESCE(rif, ''), COALESCE(fiscal_address, '') FROM businesses WHERE id = b
  ON CONFLICT (business_id) DO NOTHING;
  SELECT * INTO r FROM fiscal_profiles WHERE business_id = b FOR UPDATE;
  IF r.status IN ('submitted', 'active') THEN RAISE EXCEPTION 'La solicitud ya fue enviada; no se puede modificar'; END IF;

  UPDATE fiscal_profiles SET
    person_type         = COALESCE(p->>'person_type', person_type),
    taxpayer_type       = COALESCE(p->>'taxpayer_type', taxpayer_type),
    current_method      = COALESCE(p->>'current_method', current_method),
    legal_name          = COALESCE(btrim(p->>'legal_name'), legal_name),
    rif                 = COALESCE(upper(btrim(p->>'rif')), rif),
    representative_name = COALESCE(btrim(p->>'representative_name'), representative_name),
    representative_id   = COALESCE(upper(btrim(p->>'representative_id')), representative_id),
    fiscal_address      = COALESCE(btrim(p->>'fiscal_address'), fiscal_address),
    city                = COALESCE(btrim(p->>'city'), city),
    main_activity       = COALESCE(btrim(p->>'main_activity'), main_activity),
    phone               = COALESCE(btrim(p->>'phone'), phone),
    email               = COALESCE(btrim(p->>'email'), email),
    documents           = CASE WHEN p ? 'documents' THEN p->'documents' ELSE documents END,
    signature_path      = COALESCE(p->>'signature_path', signature_path),
    seal_path           = COALESCE(p->>'seal_path', seal_path),
    status              = 'draft',
    updated_at          = now()
  WHERE business_id = b RETURNING * INTO r;
  RETURN r;
END $$;
