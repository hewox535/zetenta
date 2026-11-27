/*
# Historial de cambios (auditoría)

Quién cambió qué y cuándo: precios, costos, ofertas, datos de productos y
variaciones, categorías, fotos, disponibilidad, descuentos, cuentas de cobro,
sucursales, personal, configuración del negocio, gastos y clientes.

- audit_log: una fila por cambio, con el antes y el después de cada campo
  ({"price": [12, 15]}) y una etiqueta legible (producto · variación).
- La llenan triggers (AFTER) en cada tabla: entra todo, venga de la app, de
  una importación o de una función del servidor. Los usuarios solo pueden leer
  (sin políticas de escritura): el historial no se edita ni se borra.
- No registra cantidades de stock (eso es Inventario → Movimientos) ni
  contadores internos (número de venta, de retención).
- Lee el historial: el administrador del negocio, todo; quien tiene el módulo
  de inventario, lo de productos.
*/

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_name text NOT NULL DEFAULT '',
  area text NOT NULL,          -- productos | descuentos | cobros | sucursales | personal | configuracion | gastos | clientes
  entity text NOT NULL,        -- tabla de origen
  entity_id uuid,
  product_id uuid,             -- para filtrar por producto
  label text NOT NULL DEFAULT '',
  action text NOT NULL,        -- create | update | delete
  changes jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_business_time ON audit_log (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_product_time ON audit_log (product_id, created_at DESC) WHERE product_id IS NOT NULL;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_select ON audit_log;
CREATE POLICY audit_log_select ON audit_log FOR SELECT TO authenticated
  USING ((business_id = current_business_id()
          AND (is_business_admin() OR (area = 'productos' AND has_module_perm('inventory'))))
         OR is_platform_admin());

-- Nombre de quien hace el cambio ('' si es el sistema).
CREATE OR REPLACE FUNCTION public.audit_actor_name()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT COALESCE(NULLIF(full_name, ''), NULLIF(username, ''), email) FROM profiles WHERE id = auth.uid()), '')
$$;

-- "Talla M · Rojo" a partir de los atributos de una variación.
CREATE OR REPLACE FUNCTION public.audit_variant_text(p_attrs jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(string_agg(value, ' · ' ORDER BY key), '') FROM jsonb_each_text(COALESCE(p_attrs, '{}'::jsonb))
$$;

-- Trigger genérico. TG_ARGV[0] = área, TG_ARGV[1] = columnas a seguir (separadas por coma).
CREATE OR REPLACE FUNCTION public.audit_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  r jsonb := COALESCE(n, o);
  cols text[] := string_to_array(TG_ARGV[1], ',');
  c text;
  diff jsonb := '{}'::jsonb;
  v_business uuid;
  v_product uuid;
  v_label text := '';
  v_id uuid;
BEGIN
  -- Ruido que no se registra: la variación única de un producto simple (ya está
  -- el alta/baja del producto) y lo que se borra en cascada con su producto.
  IF TG_TABLE_NAME IN ('product_variants', 'product_media') AND TG_OP <> 'UPDATE' THEN
    IF TG_TABLE_NAME = 'product_variants' AND COALESCE(r -> 'attributes', '{}'::jsonb) = '{}'::jsonb THEN RETURN NULL; END IF;
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM products WHERE id = (r ->> 'product_id')::uuid) THEN RETURN NULL; END IF;
  END IF;

  FOREACH c IN ARRAY cols LOOP
    IF TG_OP = 'UPDATE' THEN
      IF (o -> c) IS DISTINCT FROM (n -> c) THEN diff := diff || jsonb_build_object(c, jsonb_build_array(o -> c, n -> c)); END IF;
    ELSIF TG_OP = 'INSERT' THEN
      IF (n -> c) IS NOT NULL AND (n -> c) NOT IN ('null'::jsonb, '""'::jsonb, '{}'::jsonb, '[]'::jsonb) THEN diff := diff || jsonb_build_object(c, jsonb_build_array(NULL, n -> c)); END IF;
    ELSE
      IF (o -> c) IS NOT NULL AND (o -> c) NOT IN ('null'::jsonb, '""'::jsonb, '{}'::jsonb, '[]'::jsonb) THEN diff := diff || jsonb_build_object(c, jsonb_build_array(o -> c, NULL)); END IF;
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND diff = '{}'::jsonb THEN RETURN NULL; END IF;

  v_business := CASE WHEN TG_TABLE_NAME = 'businesses' THEN (r ->> 'id')::uuid ELSE (r ->> 'business_id')::uuid END;
  v_id := CASE WHEN r ? 'id' THEN (r ->> 'id')::uuid END;
  IF v_business IS NULL THEN RETURN NULL; END IF;

  CASE TG_TABLE_NAME
    WHEN 'products' THEN v_product := v_id; v_label := r ->> 'name';
    WHEN 'product_variants' THEN
      v_product := (r ->> 'product_id')::uuid;
      v_label := COALESCE((SELECT name FROM products WHERE id = v_product), 'Producto eliminado')
                 || COALESCE(NULLIF(' · ' || audit_variant_text(r -> 'attributes'), ' · '), '');
    WHEN 'product_media' THEN
      v_product := (r ->> 'product_id')::uuid;
      v_label := COALESCE((SELECT name FROM products WHERE id = v_product), 'Producto eliminado')
                 || COALESCE(' · ' || NULLIF(audit_variant_text((SELECT attributes FROM product_variants WHERE id = (r ->> 'variant_id')::uuid)), ''), '');
    WHEN 'variant_stock' THEN
      SELECT v.product_id, COALESCE(p.name, '') || COALESCE(NULLIF(' · ' || audit_variant_text(v.attributes), ' · '), '')
             || ' · ' || COALESCE((SELECT name FROM branches WHERE id = (r ->> 'branch_id')::uuid), '')
        INTO v_product, v_label
        FROM product_variants v LEFT JOIN products p ON p.id = v.product_id WHERE v.id = (r ->> 'variant_id')::uuid;
    WHEN 'businesses' THEN v_label := 'Negocio';
    WHEN 'profiles' THEN v_label := COALESCE(NULLIF(r ->> 'full_name', ''), r ->> 'username', r ->> 'email', '');
    ELSE v_label := COALESCE(r ->> 'name', '');
  END CASE;

  INSERT INTO audit_log (business_id, actor_id, actor_name, area, entity, entity_id, product_id, label, action, changes)
  VALUES (v_business, auth.uid(), audit_actor_name(), TG_ARGV[0], TG_TABLE_NAME, v_id, v_product, COALESCE(v_label, ''),
          lower(TG_OP), diff);
  RETURN NULL;
END $$;

-- Categorías y etiquetas de un producto (product_terms no tiene business_id ni id).
CREATE OR REPLACE FUNCTION public.audit_product_terms()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r product_terms%ROWTYPE := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  p products%ROWTYPE;
  t text;
BEGIN
  SELECT * INTO p FROM products WHERE id = r.product_id;
  IF p.id IS NULL THEN RETURN NULL; END IF;   -- el producto se está borrando
  SELECT tx.name || ': ' || tt.name INTO t FROM taxonomy_terms tt JOIN taxonomies tx ON tx.id = tt.taxonomy_id WHERE tt.id = r.term_id;
  INSERT INTO audit_log (business_id, actor_id, actor_name, area, entity, entity_id, product_id, label, action, changes)
  VALUES (p.business_id, auth.uid(), audit_actor_name(), 'productos', 'product_terms', p.id, p.id, p.name, 'update',
          jsonb_build_object('term', CASE WHEN TG_OP = 'INSERT' THEN jsonb_build_array(NULL, t) ELSE jsonb_build_array(t, NULL) END));
  RETURN NULL;
END $$;

-- ---------- Triggers ----------
DROP TRIGGER IF EXISTS zz_audit ON products;
CREATE TRIGGER zz_audit AFTER INSERT OR UPDATE OR DELETE ON products FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('productos', 'name,sku,unit,price,cost,note,offer_percent,offer_price,track_stock,variant_axes');
DROP TRIGGER IF EXISTS zz_audit ON product_variants;
CREATE TRIGGER zz_audit AFTER INSERT OR UPDATE OR DELETE ON product_variants FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('productos', 'sku,price,cost,attributes,active,target_stock');
DROP TRIGGER IF EXISTS zz_audit ON product_media;
CREATE TRIGGER zz_audit AFTER INSERT OR DELETE ON product_media FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('productos', 'path');
DROP TRIGGER IF EXISTS zz_audit ON product_terms;
CREATE TRIGGER zz_audit AFTER INSERT OR DELETE ON product_terms FOR EACH ROW
  EXECUTE FUNCTION public.audit_product_terms();
-- Disponible/Agotado por sucursal (productos sin control de inventario).
DROP TRIGGER IF EXISTS zz_audit ON variant_stock;
CREATE TRIGGER zz_audit AFTER UPDATE OF available ON variant_stock FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('productos', 'available');
DROP TRIGGER IF EXISTS zz_audit_ins ON variant_stock;
CREATE TRIGGER zz_audit_ins AFTER INSERT ON variant_stock FOR EACH ROW WHEN (NOT NEW.available)
  EXECUTE FUNCTION public.audit_changes('productos', 'available');

DROP TRIGGER IF EXISTS zz_audit ON discounts;
CREATE TRIGGER zz_audit AFTER INSERT OR UPDATE OR DELETE ON discounts FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('descuentos', 'name,cash_percent,cashea_percent,starts_on,ends_on,active,term_ids');
DROP TRIGGER IF EXISTS zz_audit ON bank_accounts;
CREATE TRIGGER zz_audit AFTER INSERT OR UPDATE OR DELETE ON bank_accounts FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('cobros', 'name,currency,opening_balance,active,is_cash,details');
DROP TRIGGER IF EXISTS zz_audit ON payment_methods;
CREATE TRIGGER zz_audit AFTER INSERT OR UPDATE OR DELETE ON payment_methods FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('cobros', 'name,description,active,kind');
DROP TRIGGER IF EXISTS zz_audit ON branches;
CREATE TRIGGER zz_audit AFTER INSERT OR UPDATE OR DELETE ON branches FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('sucursales', 'name,address,active,is_default');
DROP TRIGGER IF EXISTS zz_audit ON profiles;
CREATE TRIGGER zz_audit AFTER UPDATE OR DELETE ON profiles FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('personal', 'full_name,username,business_role,permissions,all_branches');
DROP TRIGGER IF EXISTS zz_audit ON businesses;
CREATE TRIGGER zz_audit AFTER UPDATE ON businesses FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('configuracion',
    'name,rif,fiscal_address,rate_config,foreign_discount_percent,local_discount_percent,low_stock_percent,customer_config,catalog_enabled,catalog_whatsapp,catalog_tagline,cashea_initial_percent,cash_mode,branding,slug,custom_domain,capabilities,status,stamp_url');
DROP TRIGGER IF EXISTS zz_audit ON expenses;
CREATE TRIGGER zz_audit AFTER INSERT OR UPDATE OR DELETE ON expenses FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('gastos', 'name,kind,amount,currency,amount_usd,spent_on,status,account_name,supplier_name,note');
DROP TRIGGER IF EXISTS zz_audit ON recurring_expenses;
CREATE TRIGGER zz_audit AFTER INSERT OR UPDATE OR DELETE ON recurring_expenses FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('gastos', 'name,amount,currency,frequency,active,note');
DROP TRIGGER IF EXISTS zz_audit ON customers;
CREATE TRIGGER zz_audit AFTER UPDATE OR DELETE ON customers FOR EACH ROW
  EXECUTE FUNCTION public.audit_changes('clientes', 'name,document,phone,email');
