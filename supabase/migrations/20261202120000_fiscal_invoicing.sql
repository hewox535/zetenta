-- Facturación digital (Providencia SNAT/2024/000102 y SNAT/2026/00093).
-- Ver docs/facturacion-digital-seniat.md.
--
-- Esta migración prepara todo lo que no depende de la imprenta digital:
--   * IVA por producto (16 % general, 8 % reducida o exento). El precio de
--     venta ya incluye el IVA: la factura lo desglosa.
--   * Perfil fiscal del negocio: la solicitud de activación (datos,
--     documentos, firma y sello) y su estado (borrador → enviada → activa).
--   * Facturas, notas de crédito y notas de débito con:
--     - numeración correlativa sin huecos, por negocio y tipo;
--     - datos del emisor y del cliente congelados al emitir;
--     - montos en bolívares por alícuota.
--     El número de control queda "pendiente" hasta que lo asigne la imprenta
--     (control_status), que es el último paso de la integración.
--   * Al anular una venta facturada se emite sola la nota de crédito.

-- ---------- IVA por producto ----------
ALTER TABLE products ADD COLUMN IF NOT EXISTS iva_rate numeric(5,2) NOT NULL DEFAULT 16;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_iva_rate_check;
ALTER TABLE products ADD CONSTRAINT products_iva_rate_check CHECK (iva_rate IN (0, 8, 16));

-- La alícuota queda congelada en cada línea vendida (si luego cambia el
-- producto, la venta conserva la suya).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS iva_rate numeric(5,2);
CREATE OR REPLACE FUNCTION public.set_order_item_iva()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.iva_rate IS NULL THEN
    SELECT iva_rate INTO NEW.iva_rate FROM products WHERE id = NEW.product_id;
    NEW.iva_rate := COALESCE(NEW.iva_rate, 16);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS set_order_item_iva ON order_items;
CREATE TRIGGER set_order_item_iva BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION public.set_order_item_iva();

-- Dirección fiscal del cliente (obligatoria en la factura a personas jurídicas).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '';

-- El historial de cambios registra también la alícuota.
DROP TRIGGER IF EXISTS zz_audit ON products;
CREATE TRIGGER zz_audit AFTER INSERT OR UPDATE OR DELETE ON products FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('productos', 'name,sku,unit,price,cost,note,offer_percent,offer_price,track_stock,variant_axes,iva_rate');

-- ---------- Perfil fiscal (solicitud de activación) ----------
CREATE TABLE IF NOT EXISTS fiscal_profiles (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'active', 'rejected')),
  person_type text NOT NULL DEFAULT 'natural' CHECK (person_type IN ('natural', 'juridica')),
  taxpayer_type text NOT NULL DEFAULT 'ordinario' CHECK (taxpayer_type IN ('ordinario', 'especial')),
  current_method text NOT NULL DEFAULT 'ninguno' CHECK (current_method IN ('maquina', 'forma_libre', 'digital', 'ninguno')),
  legal_name text NOT NULL DEFAULT '',
  rif text NOT NULL DEFAULT '',
  representative_name text NOT NULL DEFAULT '',
  representative_id text NOT NULL DEFAULT '',
  fiscal_address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  main_activity text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  documents jsonb NOT NULL DEFAULT '{}'::jsonb,       -- { clave: { path, name, uploaded_at } }
  signature_path text NOT NULL DEFAULT '',
  seal_path text NOT NULL DEFAULT '',
  accepted_at timestamptz,
  submitted_at timestamptz,
  activated_at timestamptz,
  review_note text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT '',                 -- imprenta digital (cuando se integre)
  invoice_seq integer NOT NULL DEFAULT 0,
  credit_seq integer NOT NULL DEFAULT 0,
  debit_seq integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fiscal_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiscal_profiles_select ON fiscal_profiles;
CREATE POLICY fiscal_profiles_select ON fiscal_profiles FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
-- Sin políticas de escritura: todo pasa por las funciones de abajo.

-- Documentos que pide cada caso (lo mismo que muestra el asistente).
CREATE OR REPLACE FUNCTION public.fiscal_required_docs(p_person text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_person = 'juridica'
    THEN ARRAY['acta', 'acta_update', 'rif', 'socios_cedula', 'socios_rif', 'licencia', 'cert_actividad']
    ELSE ARRAY['cedula', 'rif', 'recibo', 'cert_actividad'] END
$$;

-- Guarda el avance del asistente (solo el dueño, y solo mientras no esté enviada).
CREATE OR REPLACE FUNCTION public.save_fiscal_profile(p jsonb)
RETURNS fiscal_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b uuid := public.current_business_id();
  r fiscal_profiles;
BEGIN
  IF b IS NULL OR NOT public.is_business_admin() THEN RAISE EXCEPTION 'Solo el administrador del negocio puede hacer la solicitud'; END IF;
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

-- Valida que esté todo y envía la solicitud a revisión.
CREATE OR REPLACE FUNCTION public.submit_fiscal_profile()
RETURNS fiscal_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b uuid := public.current_business_id();
  r fiscal_profiles;
  missing text[] := '{}';
  d text;
BEGIN
  IF b IS NULL OR NOT public.is_business_admin() THEN RAISE EXCEPTION 'Solo el administrador del negocio puede enviar la solicitud'; END IF;
  SELECT * INTO r FROM fiscal_profiles WHERE business_id = b FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'Completa la solicitud antes de enviarla'; END IF;
  IF r.status IN ('submitted', 'active') THEN RAISE EXCEPTION 'La solicitud ya fue enviada'; END IF;
  FOREACH d IN ARRAY public.fiscal_required_docs(r.person_type) LOOP
    IF COALESCE(r.documents->d->>'path', '') = '' THEN
      missing := missing || CASE d WHEN 'cedula' THEN 'cédula' WHEN 'rif' THEN 'RIF' WHEN 'recibo' THEN 'recibo de servicio'
        WHEN 'cert_actividad' THEN 'certificado de actividad' WHEN 'acta' THEN 'acta constitutiva'
        WHEN 'acta_update' THEN 'última actualización del acta' WHEN 'socios_cedula' THEN 'cédula de los socios'
        WHEN 'socios_rif' THEN 'RIF de los socios' WHEN 'licencia' THEN 'licencia de actividad económica' ELSE d END;
    END IF;
  END LOOP;
  IF r.legal_name = '' THEN missing := missing || 'razón social'; END IF;
  IF r.rif !~ '^[VEJGPC]-?[0-9]{8,9}$' THEN missing := missing || 'RIF válido'; END IF;
  IF r.representative_name = '' OR r.representative_id = '' THEN missing := missing || 'representante'; END IF;
  IF r.fiscal_address = '' THEN missing := missing || 'domicilio fiscal'; END IF;
  IF r.main_activity = '' THEN missing := missing || 'actividad principal'; END IF;
  IF r.signature_path = '' THEN missing := missing || 'firma'; END IF;
  IF r.person_type = 'juridica' AND r.seal_path = '' THEN missing := missing || 'sello'; END IF;
  IF cardinality(missing) > 0 THEN RAISE EXCEPTION 'Falta: %', array_to_string(missing, ', '); END IF;

  UPDATE fiscal_profiles SET status = 'submitted', submitted_at = now(), accepted_at = now(), review_note = '', updated_at = now()
   WHERE business_id = b RETURNING * INTO r;
  RETURN r;
END $$;

-- Administración de la plataforma: activar o rechazar (con motivo).
CREATE OR REPLACE FUNCTION public.set_fiscal_status(p_business_id uuid, p_status text, p_note text DEFAULT '')
RETURNS fiscal_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r fiscal_profiles;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Solo la administración de Zetenta'; END IF;
  IF p_status NOT IN ('active', 'rejected', 'draft') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
  UPDATE fiscal_profiles SET status = p_status, review_note = COALESCE(p_note, ''),
         activated_at = CASE WHEN p_status = 'active' THEN now() ELSE activated_at END, updated_at = now()
   WHERE business_id = p_business_id RETURNING * INTO r;
  IF r IS NULL THEN RAISE EXCEPTION 'El negocio no tiene solicitud fiscal'; END IF;
  -- La factura sale con los datos fiscales aprobados.
  IF p_status = 'active' THEN
    UPDATE businesses SET rif = r.rif, fiscal_address = r.fiscal_address WHERE id = p_business_id;
  END IF;
  RETURN r;
END $$;

-- ---------- Facturas y notas ----------
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
  doc_type text NOT NULL CHECK (doc_type IN ('factura', 'nota_credito', 'nota_debito')),
  number integer NOT NULL,
  control_number text,
  control_status text NOT NULL DEFAULT 'pending' CHECK (control_status IN ('pending', 'assigned', 'error')),
  control_error text NOT NULL DEFAULT '',
  related_invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  reason text NOT NULL DEFAULT '',
  issued_at timestamptz NOT NULL DEFAULT now(),
  issuer jsonb NOT NULL,      -- { legal_name, rif, fiscal_address, phone, email, taxpayer_type }
  customer jsonb NOT NULL,    -- { name, document, address, phone, email }
  lines jsonb NOT NULL,       -- [{ code, description, quantity, unit_price_ves, amount_ves, iva_rate, ... }]
  payments jsonb NOT NULL DEFAULT '[]'::jsonb,
  rate numeric NOT NULL,
  rate_source text NOT NULL DEFAULT '',
  exempt_ves numeric(14,2) NOT NULL DEFAULT 0,
  base_g_ves numeric(14,2) NOT NULL DEFAULT 0,
  iva_g_ves numeric(14,2) NOT NULL DEFAULT 0,
  base_r_ves numeric(14,2) NOT NULL DEFAULT 0,
  iva_r_ves numeric(14,2) NOT NULL DEFAULT 0,
  discount_ves numeric(14,2) NOT NULL DEFAULT 0,
  igtf_base_ves numeric(14,2) NOT NULL DEFAULT 0,
  igtf_ves numeric(14,2) NOT NULL DEFAULT 0,
  total_ves numeric(14,2) NOT NULL,
  total_usd numeric(14,2) NOT NULL,
  provider_payload jsonb,
  created_by uuid DEFAULT auth.uid(),
  UNIQUE (business_id, doc_type, number)
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_per_order ON invoices (order_id) WHERE doc_type = 'factura';
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_credit_per_invoice ON invoices (related_invoice_id) WHERE doc_type = 'nota_credito';
CREATE INDEX IF NOT EXISTS invoices_business_issued ON invoices (business_id, issued_at DESC);
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_select ON invoices;
CREATE POLICY invoices_select ON invoices FOR SELECT TO authenticated
  USING ((business_id = public.current_business_id() AND public.has_module_perm('orders')
          AND (branch_id IS NULL OR public.can_access_branch(branch_id)))
         OR public.is_platform_admin());
-- Sin escritura directa: una factura emitida no se edita ni se borra.

-- Montos de una venta por alícuota, en bolívares. Los precios incluyen IVA:
-- base = monto / (1 + alícuota). El descuento de la venta se reparte
-- proporcionalmente entre las líneas.
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
BEGIN
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
  SELECT COALESCE(sum(line_total_usd), 0) INTO gross_usd FROM order_items WHERE order_id = p_order;
  IF gross_usd <= 0 THEN RAISE EXCEPTION 'La venta no tiene montos'; END IF;
  factor := GREATEST(0, (gross_usd - COALESCE(o.discount_usd, 0)) / gross_usd);

  FOR it IN SELECT oi.*, COALESCE(oi.iva_rate, 16) AS r, COALESCE(NULLIF(v.sku, ''), p.sku, '') AS code
              FROM order_items oi
              LEFT JOIN product_variants v ON v.id = oi.variant_id
              LEFT JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = p_order ORDER BY oi.id LOOP
    amt := round(it.line_total_usd * v_rate / (1 + it.r / 100), 2);          -- monto sin IVA, antes del descuento
    lines := lines || jsonb_build_object(
      'code', it.code,
      'description', it.name || CASE WHEN COALESCE(it.variant_label, '') <> '' THEN ' · ' || it.variant_label ELSE '' END,
      'quantity', it.quantity,
      'unit', COALESCE(it.unit, 'und'),
      'unit_price_ves', round(it.unit_price_usd * v_rate / (1 + it.r / 100), 2),
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

  UPDATE fiscal_profiles SET invoice_seq = invoice_seq + 1 WHERE business_id = p_business RETURNING invoice_seq INTO n;

  INSERT INTO invoices (business_id, branch_id, order_id, doc_type, number, issuer, customer, lines, payments,
                        rate, rate_source, exempt_ves, base_g_ves, iva_g_ves, base_r_ves, iva_r_ves, discount_ves,
                        total_ves, total_usd, created_by)
  VALUES (p_business, o.branch_id, p_order, 'factura', n,
          jsonb_build_object('legal_name', fp.legal_name, 'rif', fp.rif, 'fiscal_address', fp.fiscal_address,
                             'city', fp.city, 'phone', fp.phone, 'email', fp.email, 'taxpayer_type', fp.taxpayer_type),
          cust, lines,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('method', COALESCE(NULLIF(op.method_name, ''), op.account_name),
                      'currency', op.currency, 'amount', op.amount, 'amount_usd', op.amount_usd, 'kind', op.kind) ORDER BY op.id)
                      FROM order_payments op WHERE op.order_id = p_order), '[]'::jsonb),
          v_rate, COALESCE(o.rate_source, ''), ex, bg, round(bg * 0.16, 2), br, round(br * 0.08, 2), disc,
          ex + bg + round(bg * 0.16, 2) + br + round(br * 0.08, 2),
          round(gross_usd - COALESCE(o.discount_usd, 0), 2), p_actor)
  RETURNING * INTO inv;
  RETURN inv;
END $$;
REVOKE ALL ON FUNCTION public.fiscal_issue_invoice(uuid, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- Emitir la factura de una venta (desde el cobro o desde el detalle de la venta).
CREATE OR REPLACE FUNCTION public.issue_invoice(p_order_id uuid, p_customer jsonb)
RETURNS invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b uuid := public.current_business_id();
  br uuid;
BEGIN
  IF b IS NULL OR NOT public.has_module_perm('orders') THEN RAISE EXCEPTION 'Sin permiso para facturar'; END IF;
  SELECT branch_id INTO br FROM orders WHERE id = p_order_id AND business_id = b;
  IF br IS NOT NULL AND NOT public.can_access_branch(br) THEN RAISE EXCEPTION 'Sin acceso a esa sucursal'; END IF;
  RETURN public.fiscal_issue_invoice(b, p_order_id, p_customer, auth.uid());
END $$;

-- Nota de crédito por el total de una factura (anulación).
CREATE OR REPLACE FUNCTION public.fiscal_issue_credit_note(p_invoice uuid, p_reason text, p_actor uuid)
RETURNS invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f invoices;
  n integer;
  nc invoices;
BEGIN
  SELECT * INTO f FROM invoices WHERE id = p_invoice AND doc_type = 'factura';
  IF f IS NULL THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE related_invoice_id = f.id AND doc_type = 'nota_credito') THEN
    RAISE EXCEPTION 'Esa factura ya tiene nota de crédito';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Indica el motivo de la nota de crédito'; END IF;
  UPDATE fiscal_profiles SET credit_seq = credit_seq + 1 WHERE business_id = f.business_id RETURNING credit_seq INTO n;
  INSERT INTO invoices (business_id, branch_id, order_id, doc_type, number, related_invoice_id, reason, issuer, customer,
                        lines, payments, rate, rate_source, exempt_ves, base_g_ves, iva_g_ves, base_r_ves, iva_r_ves,
                        discount_ves, igtf_base_ves, igtf_ves, total_ves, total_usd, created_by)
  VALUES (f.business_id, f.branch_id, f.order_id, 'nota_credito', n, f.id, btrim(p_reason), f.issuer, f.customer,
          f.lines, '[]'::jsonb, f.rate, f.rate_source, f.exempt_ves, f.base_g_ves, f.iva_g_ves, f.base_r_ves, f.iva_r_ves,
          f.discount_ves, f.igtf_base_ves, f.igtf_ves, f.total_ves, f.total_usd, p_actor)
  RETURNING * INTO nc;
  RETURN nc;
END $$;
REVOKE ALL ON FUNCTION public.fiscal_issue_credit_note(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_credit_note(p_invoice_id uuid, p_reason text)
RETURNS invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM invoices WHERE id = p_invoice_id AND business_id = public.current_business_id()) THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;
  IF NOT public.is_business_admin() THEN RAISE EXCEPTION 'Solo el administrador puede emitir notas de crédito'; END IF;
  RETURN public.fiscal_issue_credit_note(p_invoice_id, p_reason, auth.uid());
END $$;

-- Anular una venta facturada emite su nota de crédito (no se deja una
-- factura viva de una venta que no existe).
CREATE OR REPLACE FUNCTION public.credit_note_on_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f uuid;
BEGIN
  SELECT id INTO f FROM invoices i WHERE i.order_id = NEW.id AND i.doc_type = 'factura'
     AND NOT EXISTS (SELECT 1 FROM invoices c WHERE c.related_invoice_id = i.id AND c.doc_type = 'nota_credito');
  IF f IS NOT NULL THEN
    PERFORM public.fiscal_issue_credit_note(f, COALESCE(NULLIF(btrim(NEW.cancel_reason), ''), 'Anulación de la venta'), COALESCE(NEW.cancelled_by, auth.uid()));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_credit_note_on_cancel ON orders;
CREATE TRIGGER zz_credit_note_on_cancel AFTER UPDATE OF cancelled_at ON orders FOR EACH ROW
  WHEN (OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL)
  EXECUTE FUNCTION public.credit_note_on_cancel();

GRANT EXECUTE ON FUNCTION public.save_fiscal_profile(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_fiscal_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_fiscal_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_credit_note(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_required_docs(text) TO authenticated;

-- ---------- Documentos de la solicitud (privados, carpeta = negocio) ----------
INSERT INTO storage.buckets (id, name, public) VALUES ('fiscal-docs', 'fiscal-docs', false)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "fiscal docs read" ON storage.objects;
CREATE POLICY "fiscal docs read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'fiscal-docs'
         AND ((storage.foldername(name))[1] = public.current_business_id()::text AND public.is_business_admin()
              OR public.is_platform_admin()));
DROP POLICY IF EXISTS "fiscal docs insert" ON storage.objects;
CREATE POLICY "fiscal docs insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fiscal-docs'
              AND (storage.foldername(name))[1] = public.current_business_id()::text AND public.is_business_admin());
DROP POLICY IF EXISTS "fiscal docs delete" ON storage.objects;
CREATE POLICY "fiscal docs delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'fiscal-docs'
         AND (storage.foldername(name))[1] = public.current_business_id()::text AND public.is_business_admin());
