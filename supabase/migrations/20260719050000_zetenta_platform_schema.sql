/*
# Zetenta platform schema

Replaces the single-tenant Spanish-named schema (empresa, proveedores,
comprobantes) with a multi-tenant English-named platform schema:

- businesses: each tenant, with a `capabilities` JSON the platform admin
  controls (retentions, inventory) and the withholding number sequence.
- profiles: one per auth user. role = 'business' | 'platform_admin'.
  Created automatically by trigger on signup; signup metadata may include
  business_name / full_name to create the tenant.
- suppliers: withholding subjects of a business.
- withholdings + withholding_lines: IVA retention vouchers. Created through
  the create_withholding() RPC so numbering is atomic per business.
- products + inventory_movements: simple inventory; stock kept in sync by
  trigger.

Security: RLS on everything. Business users only see rows of their own
business. Platform admins can read everything and update businesses
(capabilities). Business fiscal data is edited via update_business_profile()
so business users cannot touch their own capabilities.
*/

-- ---------- Drop the old single-tenant schema ----------
DROP TABLE IF EXISTS comprobantes CASCADE;
DROP TABLE IF EXISTS proveedores CASCADE;
DROP TABLE IF EXISTS empresa CASCADE;

-- ---------- Tables ----------
CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  rif text NOT NULL DEFAULT '',
  fiscal_address text NOT NULL DEFAULT '',
  capabilities jsonb NOT NULL DEFAULT '{"retentions": true, "inventory": true}',
  withholding_seq integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid REFERENCES businesses(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'business' CHECK (role IN ('business', 'platform_admin')),
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  rif text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, rif)
);

CREATE TABLE withholdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  number text NOT NULL,
  issue_date date NOT NULL,
  fiscal_period text NOT NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name text NOT NULL,
  supplier_rif text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, number)
);

CREATE TABLE withholding_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withholding_id uuid NOT NULL REFERENCES withholdings(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  operation_date date NOT NULL,
  invoice_number text NOT NULL DEFAULT '',
  control_number text NOT NULL DEFAULT '',
  debit_note text NOT NULL DEFAULT '',
  credit_note text NOT NULL DEFAULT '',
  transaction_type text NOT NULL DEFAULT '01-Reg.',
  affected_document text NOT NULL DEFAULT '',
  total_with_vat numeric(14,2) NOT NULL DEFAULT 0,
  exempt_amount numeric(14,2) NOT NULL DEFAULT 0,
  vat_rate numeric(5,2) NOT NULL DEFAULT 16,
  retention_rate numeric(5,2) NOT NULL DEFAULT 75
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'und',
  price numeric(14,2) NOT NULL DEFAULT 0,
  stock numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('in', 'out', 'adjustment')),
  quantity numeric(14,2) NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_suppliers_business ON suppliers (business_id);
CREATE INDEX idx_withholdings_business ON withholdings (business_id, created_at DESC);
CREATE INDEX idx_lines_withholding ON withholding_lines (withholding_id);
CREATE INDEX idx_products_business ON products (business_id);
CREATE INDEX idx_movements_business ON inventory_movements (business_id, created_at DESC);

-- ---------- Helper functions (SECURITY DEFINER avoids RLS recursion) ----------
CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT business_id FROM profiles WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'platform_admin') $$;

-- ---------- Signup trigger: create tenant + profile ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'business_name', '') <> '' THEN
    INSERT INTO businesses (name) VALUES (NEW.raw_user_meta_data->>'business_name')
    RETURNING id INTO b_id;
  END IF;
  INSERT INTO profiles (id, business_id, full_name, email)
  VALUES (NEW.id, b_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), COALESCE(NEW.email, ''));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- Business profile update (fiscal data only, never capabilities) ----------
CREATE OR REPLACE FUNCTION public.update_business_profile(p_name text, p_rif text, p_fiscal_address text)
RETURNS businesses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
BEGIN
  UPDATE businesses
     SET name = p_name, rif = p_rif, fiscal_address = p_fiscal_address
   WHERE id = public.current_business_id()
   RETURNING * INTO b;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  RETURN b;
END $$;

-- ---------- Withholding creation with atomic numbering ----------
CREATE OR REPLACE FUNCTION public.create_withholding(p_supplier_id uuid, p_issue_date date, p_lines jsonb)
RETURNS withholdings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
  s suppliers%ROWTYPE;
  w withholdings%ROWTYPE;
  period text;
  seq integer;
  l jsonb;
  i integer := 0;
BEGIN
  SELECT * INTO b FROM businesses WHERE id = public.current_business_id() FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  IF NOT COALESCE((b.capabilities->>'retentions')::boolean, false) THEN
    RAISE EXCEPTION 'Retentions capability is disabled for this business';
  END IF;
  SELECT * INTO s FROM suppliers WHERE id = p_supplier_id AND business_id = b.id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Supplier not found'; END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one line is required';
  END IF;

  period := to_char(p_issue_date, 'YYYYMM');
  seq := b.withholding_seq;
  UPDATE businesses SET withholding_seq = withholding_seq + 1 WHERE id = b.id;

  INSERT INTO withholdings (business_id, number, issue_date, fiscal_period, supplier_id, supplier_name, supplier_rif)
  VALUES (b.id, period || lpad(seq::text, 8, '0'), p_issue_date, period, s.id, s.name, s.rif)
  RETURNING * INTO w;

  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    i := i + 1;
    INSERT INTO withholding_lines (
      withholding_id, line_number, operation_date, invoice_number, control_number,
      debit_note, credit_note, transaction_type, affected_document,
      total_with_vat, exempt_amount, vat_rate, retention_rate
    ) VALUES (
      w.id, i,
      COALESCE(NULLIF(l->>'operation_date', '')::date, p_issue_date),
      COALESCE(l->>'invoice_number', ''),
      COALESCE(l->>'control_number', ''),
      COALESCE(l->>'debit_note', ''),
      COALESCE(l->>'credit_note', ''),
      COALESCE(NULLIF(l->>'transaction_type', ''), '01-Reg.'),
      COALESCE(l->>'affected_document', ''),
      COALESCE(NULLIF(l->>'total_with_vat', '')::numeric, 0),
      COALESCE(NULLIF(l->>'exempt_amount', '')::numeric, 0),
      COALESCE(NULLIF(l->>'vat_rate', '')::numeric, 16),
      COALESCE(NULLIF(l->>'retention_rate', '')::numeric, 75)
    );
  END LOOP;
  RETURN w;
END $$;

-- ---------- Inventory: stock kept in sync by trigger ----------
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
  IF new_stock < 0 THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER on_inventory_movement
  AFTER INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.apply_inventory_movement();

-- ---------- Row Level Security ----------
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE withholdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE withholding_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- businesses: members read their own; admins read & update all
CREATE POLICY businesses_select ON businesses FOR SELECT TO authenticated
  USING (id = public.current_business_id() OR public.is_platform_admin());
CREATE POLICY businesses_admin_update ON businesses FOR UPDATE TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- profiles: own profile; admins read all
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_platform_admin());
CREATE POLICY profiles_update_own ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid()));

-- suppliers
CREATE POLICY suppliers_select ON suppliers FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
CREATE POLICY suppliers_insert ON suppliers FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());
CREATE POLICY suppliers_update ON suppliers FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY suppliers_delete ON suppliers FOR DELETE TO authenticated
  USING (business_id = public.current_business_id());

-- withholdings (insert goes through the RPC; select/delete direct)
CREATE POLICY withholdings_select ON withholdings FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
CREATE POLICY withholdings_delete ON withholdings FOR DELETE TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY withholding_lines_select ON withholding_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM withholdings w
    WHERE w.id = withholding_id
      AND (w.business_id = public.current_business_id() OR public.is_platform_admin())
  ));

-- products
CREATE POLICY products_select ON products FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
CREATE POLICY products_insert ON products FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());
CREATE POLICY products_update ON products FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY products_delete ON products FOR DELETE TO authenticated
  USING (business_id = public.current_business_id());

-- inventory movements (append-only log)
CREATE POLICY movements_select ON inventory_movements FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
CREATE POLICY movements_insert ON inventory_movements FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.current_business_id()
    AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.business_id = public.current_business_id())
  );

-- ---------- Grants ----------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT EXECUTE ON FUNCTION public.current_business_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_business_profile(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_withholding(uuid, date, jsonb) TO authenticated;
