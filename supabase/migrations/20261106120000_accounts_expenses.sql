/*
# Cuentas por cobrar / pagar y Gastos

Dos módulos nuevos, conectados con Ventas y con la Caja:

## Cuentas por cobrar y por pagar
- debts: una deuda. kind 'receivable' (nos deben) o 'payable' (debemos).
  La contraparte es un cliente, un proveedor u "otro" (texto libre: un
  empleado, el dueño, un préstamo). Montos en dólares, como las ventas.
  paid_usd lo mantienen las funciones de cobro; el saldo es amount − paid.
- debt_payments: cada cobro o pago (abono), con la cuenta por donde entró o
  salió la plata, su moneda y la tasa.
- Venta a crédito: create_order acepta p_credit_due. Lo que no se cobró en
  la venta queda como cuenta por cobrar del cliente (orders.credit_usd).
  Si la venta se cancela, su cuenta por cobrar queda anulada (trigger).

## Gastos
- expense_categories: categorías del negocio (nacen unas por defecto).
- recurring_expenses: gastos fijos (alquiler, nómina…) con su frecuencia y
  la fecha del próximo pago. Registrar el pago avanza esa fecha.
- expenses: cada gasto. Pagado desde una cuenta, o pendiente: entonces
  nace una cuenta por pagar (debts.expense_id) y el gasto se marca pagado
  cuando esa deuda se salda.
- Comprobantes en el bucket privado expense-receipts, carpeta = negocio.

## Caja
Los cobros, pagos y gastos hechos con una cuenta de efectivo mientras la
caja de la sucursal está abierta se anotan solos como movimiento de caja
(cash_movements), así el arqueo los cuenta sin hacer nada más.

## Permisos
Módulos 'accounts' y 'expenses' en capabilities (activos para todos) y como
permisos delegables a una vendedora.
*/

-- ---------- Permiso genérico por módulo ----------
CREATE OR REPLACE FUNCTION public.has_module_perm(p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.id = auth.uid()
       AND (p.role = 'platform_admin' OR p.business_role = 'admin'
            OR COALESCE((p.permissions ->> p_key)::boolean, false))
  )
$$;
GRANT EXECUTE ON FUNCTION public.has_module_perm(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_staff_permissions(p_user uuid, p_permissions jsonb)
RETURNS profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me profiles%ROWTYPE;
  target profiles%ROWTYPE;
  k text;
BEGIN
  SELECT * INTO me FROM profiles WHERE id = auth.uid();
  IF me.business_id IS NULL OR me.business_role <> 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador del negocio puede cambiar permisos';
  END IF;
  FOR k IN SELECT jsonb_object_keys(COALESCE(p_permissions, '{}'::jsonb)) LOOP
    IF k NOT IN ('inventory', 'stats', 'retentions', 'cash', 'accounts', 'expenses',
                 'inv_edit_info', 'inv_edit_media', 'inv_edit_price',
                 'inv_edit_stock', 'inv_create', 'inv_delete') THEN
      RAISE EXCEPTION 'Permiso desconocido: %', k;
    END IF;
  END LOOP;
  SELECT * INTO target FROM profiles WHERE id = p_user AND business_id = me.business_id;
  IF target.id IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado en tu negocio'; END IF;
  IF target.role = 'platform_admin' THEN RAISE EXCEPTION 'No permitido'; END IF;
  UPDATE profiles SET permissions = COALESCE(p_permissions, '{}'::jsonb)
   WHERE id = p_user RETURNING * INTO target;
  RETURN target;
END $$;

UPDATE businesses SET capabilities = capabilities || '{"accounts": true}'::jsonb WHERE NOT (capabilities ? 'accounts');
UPDATE businesses SET capabilities = capabilities || '{"expenses": true}'::jsonb WHERE NOT (capabilities ? 'expenses');
ALTER TABLE businesses ALTER COLUMN capabilities
  SET DEFAULT '{"retentions": true, "inventory": true, "orders": true, "stats": true, "cash": true, "accounts": true, "expenses": true}';

-- ---------- Gastos: categorías, fijos y gastos ----------
CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_expense_category_name
  ON expense_categories (business_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'VES')),
  frequency text NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  next_due date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_business ON recurring_expenses (business_id, next_due);

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'variable' CHECK (kind IN ('variable', 'fixed')),
  name text NOT NULL CHECK (btrim(name) <> ''),
  category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name text NOT NULL DEFAULT '',
  amount numeric(18,2) NOT NULL CHECK (amount > 0),   -- en su moneda
  currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'VES')),
  rate numeric(18,6) NOT NULL DEFAULT 0,
  amount_usd numeric(14,2) NOT NULL,
  spent_on date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'pending')),
  account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  account_name text NOT NULL DEFAULT '',
  recurring_id uuid REFERENCES recurring_expenses(id) ON DELETE SET NULL,
  cash_movement_id uuid REFERENCES cash_movements(id) ON DELETE SET NULL,
  receipt_path text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_business ON expenses (business_id, spent_on DESC);

-- ---------- Cuentas por cobrar y por pagar ----------
CREATE TABLE IF NOT EXISTS debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('receivable', 'payable')),
  party_type text NOT NULL DEFAULT 'other' CHECK (party_type IN ('customer', 'supplier', 'other')),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  party_name text NOT NULL CHECK (btrim(party_name) <> ''),
  concept text NOT NULL DEFAULT '',
  amount_usd numeric(14,2) NOT NULL CHECK (amount_usd > 0),
  paid_usd numeric(14,2) NOT NULL DEFAULT 0,
  issue_date date NOT NULL DEFAULT current_date,
  due_date date,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  expense_id uuid REFERENCES expenses(id) ON DELETE SET NULL,
  note text NOT NULL DEFAULT '',
  cancelled_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_debts_business ON debts (business_id, kind, due_date);
CREATE INDEX IF NOT EXISTS idx_debts_order ON debts (order_id);
CREATE INDEX IF NOT EXISTS idx_debts_expense ON debts (expense_id);

CREATE TABLE IF NOT EXISTS debt_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  debt_id uuid NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  account_name text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'VES')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),   -- en la moneda de la cuenta
  rate numeric(18,6) NOT NULL DEFAULT 0,
  amount_usd numeric(14,2) NOT NULL CHECK (amount_usd > 0),
  note text NOT NULL DEFAULT '',
  cash_movement_id uuid REFERENCES cash_movements(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments (debt_id, created_at);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS credit_usd numeric(14,2) NOT NULL DEFAULT 0;

-- ---------- Categorías por defecto ----------
CREATE OR REPLACE FUNCTION public.seed_expense_categories(p_business uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO expense_categories (business_id, name, sort_order)
  SELECT p_business, n, o FROM unnest(ARRAY[
    'Alquiler', 'Nómina', 'Servicios', 'Mercancía e insumos', 'Transporte y delivery',
    'Publicidad', 'Mantenimiento', 'Impuestos', 'Comisiones bancarias', 'Otros'
  ]) WITH ORDINALITY AS t(n, o)
  ON CONFLICT DO NOTHING
$$;

SELECT public.seed_expense_categories(id) FROM businesses
 WHERE NOT EXISTS (SELECT 1 FROM expense_categories c WHERE c.business_id = businesses.id);

CREATE OR REPLACE FUNCTION public.trg_seed_expense_categories()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.seed_expense_categories(NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_business_expense_categories ON businesses;
CREATE TRIGGER trg_business_expense_categories AFTER INSERT ON businesses
  FOR EACH ROW EXECUTE FUNCTION public.trg_seed_expense_categories();

-- ---------- Movimiento de caja automático ----------
-- Si la cuenta es de efectivo y la caja de la sucursal está abierta, anota el
-- movimiento y devuelve su id; si no, NULL (no toca la caja).
CREATE OR REPLACE FUNCTION public.auto_cash_movement(
  p_business uuid, p_branch uuid, p_account bank_accounts, p_direction text, p_amount numeric, p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s_id uuid;
  m_id uuid;
BEGIN
  IF p_account.id IS NULL OR NOT p_account.is_cash OR p_amount <= 0 THEN RETURN NULL; END IF;
  SELECT id INTO s_id FROM cash_sessions
   WHERE business_id = p_business AND closed_at IS NULL
     AND branch_id IS NOT DISTINCT FROM COALESCE(p_branch, public.default_branch_id(p_business))
   LIMIT 1;
  IF s_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO cash_movements (business_id, session_id, account_id, account_name, currency,
                              direction, amount, reason, created_by)
  VALUES (p_business, s_id, p_account.id, p_account.name, p_account.currency,
          p_direction, round(p_amount, 2), left(p_reason, 200), auth.uid())
  RETURNING id INTO m_id;
  RETURN m_id;
END $$;

-- Deshace (o reduce) un movimiento automático, solo si su caja sigue abierta.
-- Con la caja ya cerrada el arqueo quedó congelado y no se toca.
CREATE OR REPLACE FUNCTION public.undo_cash_movement(p_movement uuid, p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m cash_movements%ROWTYPE;
BEGIN
  IF p_movement IS NULL THEN RETURN; END IF;
  SELECT * INTO m FROM cash_movements WHERE id = p_movement;
  IF m.id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM cash_sessions WHERE id = m.session_id AND closed_at IS NOT NULL) THEN RETURN; END IF;
  IF m.amount - round(p_amount, 2) <= 0.004 THEN
    DELETE FROM cash_movements WHERE id = m.id;
  ELSE
    UPDATE cash_movements SET amount = amount - round(p_amount, 2) WHERE id = m.id;
  END IF;
END $$;

-- =====================================================================
-- Cuentas por cobrar / pagar
-- =====================================================================

-- Crear una deuda a mano (préstamo, compra a crédito, adelanto…).
CREATE OR REPLACE FUNCTION public.create_debt(
  p_kind text, p_party_type text, p_customer_id uuid, p_supplier_id uuid, p_party_name text,
  p_concept text, p_amount_usd numeric, p_issue_date date, p_due_date date,
  p_note text DEFAULT '', p_branch_id uuid DEFAULT NULL
) RETURNS debts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid := public.current_business_id();
  v_name text := btrim(COALESCE(p_party_name, ''));
  d debts%ROWTYPE;
BEGIN
  IF NOT public.has_module_perm('accounts') THEN RAISE EXCEPTION 'No tienes permiso para registrar cuentas'; END IF;
  IF b_id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  IF p_kind NOT IN ('receivable', 'payable') THEN RAISE EXCEPTION 'Tipo de cuenta inválido'; END IF;
  IF p_amount_usd IS NULL OR p_amount_usd <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor que cero'; END IF;

  IF p_party_type = 'customer' THEN
    SELECT name INTO v_name FROM customers WHERE id = p_customer_id AND business_id = b_id;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
  ELSIF p_party_type = 'supplier' THEN
    SELECT name INTO v_name FROM suppliers WHERE id = p_supplier_id AND business_id = b_id;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Proveedor no encontrado'; END IF;
  ELSIF p_party_type <> 'other' THEN
    RAISE EXCEPTION 'Contraparte inválida';
  END IF;
  IF COALESCE(v_name, '') = '' THEN RAISE EXCEPTION 'Escribe a quién corresponde la cuenta'; END IF;

  INSERT INTO debts (business_id, branch_id, kind, party_type, customer_id, supplier_id, party_name,
                     concept, amount_usd, issue_date, due_date, note, created_by)
  VALUES (b_id, COALESCE(p_branch_id, public.default_branch_id(b_id)), p_kind, p_party_type,
          CASE WHEN p_party_type = 'customer' THEN p_customer_id END,
          CASE WHEN p_party_type = 'supplier' THEN p_supplier_id END,
          v_name, btrim(COALESCE(p_concept, '')), round(p_amount_usd, 2),
          COALESCE(p_issue_date, current_date), p_due_date, btrim(COALESCE(p_note, '')), auth.uid())
  RETURNING * INTO d;
  RETURN d;
END $$;

-- Editar concepto, vencimiento, nota y monto (nunca por debajo de lo abonado).
CREATE OR REPLACE FUNCTION public.update_debt(
  p_id uuid, p_concept text, p_amount_usd numeric, p_due_date date, p_note text
) RETURNS debts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d debts%ROWTYPE;
BEGIN
  IF NOT public.has_module_perm('accounts') THEN RAISE EXCEPTION 'No tienes permiso para editar cuentas'; END IF;
  SELECT * INTO d FROM debts WHERE id = p_id AND business_id = public.current_business_id() FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Cuenta no encontrada'; END IF;
  IF p_amount_usd IS NULL OR p_amount_usd <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor que cero'; END IF;
  IF round(p_amount_usd, 2) + 0.004 < d.paid_usd THEN
    RAISE EXCEPTION 'El monto no puede ser menor que lo ya abonado (%)', d.paid_usd;
  END IF;
  IF d.order_id IS NOT NULL AND round(p_amount_usd, 2) <> d.amount_usd THEN
    RAISE EXCEPTION 'El monto de una venta a crédito no se cambia; cancela o ajusta la venta';
  END IF;
  UPDATE debts SET concept = btrim(COALESCE(p_concept, '')), amount_usd = round(p_amount_usd, 2),
                   due_date = p_due_date, note = btrim(COALESCE(p_note, ''))
   WHERE id = p_id RETURNING * INTO d;
  RETURN d;
END $$;

-- Borrar una deuda sin abonos. Las de una venta se anulan cancelando la venta;
-- las de un gasto pendiente, borrando el gasto.
CREATE OR REPLACE FUNCTION public.delete_debt(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d debts%ROWTYPE;
BEGIN
  IF NOT public.has_module_perm('accounts') THEN RAISE EXCEPTION 'No tienes permiso para borrar cuentas'; END IF;
  SELECT * INTO d FROM debts WHERE id = p_id AND business_id = public.current_business_id();
  IF d.id IS NULL THEN RAISE EXCEPTION 'Cuenta no encontrada'; END IF;
  IF d.order_id IS NOT NULL THEN RAISE EXCEPTION 'Esta cuenta viene de una venta: cancela la venta para anularla'; END IF;
  IF d.expense_id IS NOT NULL THEN RAISE EXCEPTION 'Esta cuenta viene de un gasto: bórralo desde Gastos'; END IF;
  IF EXISTS (SELECT 1 FROM debt_payments WHERE debt_id = d.id) THEN
    RAISE EXCEPTION 'La cuenta ya tiene abonos; borra primero los abonos';
  END IF;
  DELETE FROM debts WHERE id = d.id;
END $$;

-- Cobrar o pagar. p_amount va en la moneda de la cuenta; se reparte entre las
-- deudas indicadas, de la que vence primero a la última. Devuelve cuánto se
-- aplicó en dólares.
CREATE OR REPLACE FUNCTION public.pay_debts(
  p_debt_ids uuid[], p_account_id uuid, p_amount numeric, p_rate numeric, p_note text DEFAULT ''
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid := public.current_business_id();
  a bank_accounts%ROWTYPE;
  d debts%ROWTYPE;
  v_kind text;
  v_branch uuid;
  v_names text;
  v_total_usd numeric;
  v_left numeric;
  v_balance numeric;
  v_alloc numeric;
  v_alloc_cur numeric;
  v_paid_cur numeric := 0;
  v_count integer := 0;
  v_mov uuid;
  ids uuid[] := ARRAY[]::uuid[];
  amts numeric[] := ARRAY[]::numeric[];
  i integer;
BEGIN
  IF NOT public.has_module_perm('accounts') THEN RAISE EXCEPTION 'No tienes permiso para cobrar o pagar cuentas'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor que cero'; END IF;
  SELECT * INTO a FROM bank_accounts WHERE id = p_account_id AND business_id = b_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Elige la cuenta por donde entra o sale el dinero'; END IF;
  IF a.currency = 'VES' AND (p_rate IS NULL OR p_rate <= 0) THEN RAISE EXCEPTION 'Falta la tasa de cambio'; END IF;

  v_total_usd := CASE WHEN a.currency = 'USD' THEN round(p_amount, 2) ELSE round(p_amount / p_rate, 2) END;
  v_left := v_total_usd;

  FOR d IN
    SELECT * FROM debts
     WHERE id = ANY(p_debt_ids) AND business_id = b_id AND cancelled_at IS NULL
       AND amount_usd - paid_usd > 0.004
     ORDER BY due_date NULLS LAST, issue_date, created_at
     FOR UPDATE
  LOOP
    IF v_kind IS NULL THEN v_kind := d.kind; v_branch := d.branch_id; v_names := d.party_name;
    ELSIF v_kind <> d.kind THEN RAISE EXCEPTION 'No se pueden mezclar cuentas por cobrar y por pagar';
    END IF;
    EXIT WHEN v_left <= 0.004;
    v_balance := d.amount_usd - d.paid_usd;
    v_alloc := LEAST(v_balance, v_left);
    v_left := round(v_left - v_alloc, 2);
    ids := ids || d.id; amts := amts || v_alloc;
  END LOOP;

  IF v_kind IS NULL THEN RAISE EXCEPTION 'No hay saldo pendiente en esas cuentas'; END IF;
  IF v_left > 0.01 THEN
    RAISE EXCEPTION 'El monto supera el saldo pendiente por % $', v_left;
  END IF;

  v_mov := public.auto_cash_movement(b_id, v_branch, a,
    CASE WHEN v_kind = 'receivable' THEN 'in' ELSE 'out' END, p_amount,
    CASE WHEN v_kind = 'receivable' THEN 'Cobro a ' ELSE 'Pago a ' END || v_names);

  FOR i IN 1 .. array_length(ids, 1) LOOP
    v_count := v_count + 1;
    -- Monto en la moneda de la cuenta; el último se lleva el redondeo.
    IF i = array_length(ids, 1) THEN
      v_alloc_cur := round(p_amount, 2) - v_paid_cur;
    ELSE
      v_alloc_cur := CASE WHEN a.currency = 'USD' THEN amts[i] ELSE round(amts[i] * p_rate, 2) END;
    END IF;
    v_paid_cur := v_paid_cur + v_alloc_cur;
    IF v_alloc_cur <= 0 THEN CONTINUE; END IF;
    INSERT INTO debt_payments (business_id, debt_id, account_id, account_name, currency, amount, rate,
                               amount_usd, note, cash_movement_id, created_by)
    VALUES (b_id, ids[i], a.id, a.name, a.currency, v_alloc_cur, COALESCE(p_rate, 0),
            amts[i], btrim(COALESCE(p_note, '')), v_mov, auth.uid());
    UPDATE debts SET paid_usd = round(paid_usd + amts[i], 2) WHERE id = ids[i] RETURNING * INTO d;
    -- Un gasto pendiente queda pagado cuando su cuenta por pagar se salda.
    IF d.expense_id IS NOT NULL AND d.amount_usd - d.paid_usd <= 0.004 THEN
      UPDATE expenses SET status = 'paid', account_id = a.id, account_name = a.name WHERE id = d.expense_id;
    END IF;
  END LOOP;

  RETURN v_total_usd;
END $$;

-- Deshacer un abono.
CREATE OR REPLACE FUNCTION public.delete_debt_payment(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p debt_payments%ROWTYPE;
  d debts%ROWTYPE;
BEGIN
  IF NOT public.has_module_perm('accounts') THEN RAISE EXCEPTION 'No tienes permiso para borrar abonos'; END IF;
  SELECT * INTO p FROM debt_payments WHERE id = p_id AND business_id = public.current_business_id();
  IF p.id IS NULL THEN RAISE EXCEPTION 'Abono no encontrado'; END IF;
  PERFORM public.undo_cash_movement(p.cash_movement_id, p.amount);
  DELETE FROM debt_payments WHERE id = p.id;
  UPDATE debts SET paid_usd = GREATEST(0, round(paid_usd - p.amount_usd, 2)) WHERE id = p.debt_id RETURNING * INTO d;
  IF d.expense_id IS NOT NULL THEN
    UPDATE expenses SET status = 'pending' WHERE id = d.expense_id;
  END IF;
END $$;

-- Venta cancelada: su cuenta por cobrar queda anulada.
CREATE OR REPLACE FUNCTION public.trg_cancel_order_debts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL THEN
    UPDATE debts SET cancelled_at = NEW.cancelled_at WHERE order_id = NEW.id AND cancelled_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_order_cancel_debts ON orders;
CREATE TRIGGER trg_order_cancel_debts AFTER UPDATE OF cancelled_at ON orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_cancel_order_debts();

-- Avisos del menú: vencidas y por vencer en los próximos 3 días.
CREATE OR REPLACE FUNCTION public.finance_alerts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'debts', (SELECT count(*) FROM debts
               WHERE business_id = public.current_business_id() AND cancelled_at IS NULL
                 AND amount_usd - paid_usd > 0.004 AND due_date IS NOT NULL
                 AND due_date <= current_date + 3),
    'recurring', (SELECT count(*) FROM recurring_expenses
                   WHERE business_id = public.current_business_id() AND active
                     AND next_due <= current_date + 3)
  )
$$;

-- =====================================================================
-- Gastos
-- =====================================================================

CREATE OR REPLACE FUNCTION public.next_due_date(p_from date, p_frequency text)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_frequency
    WHEN 'weekly' THEN p_from + 7
    WHEN 'biweekly' THEN p_from + 14
    WHEN 'quarterly' THEN (p_from + interval '3 months')::date
    WHEN 'yearly' THEN (p_from + interval '1 year')::date
    ELSE (p_from + interval '1 month')::date
  END
$$;

-- p: {kind, name, category_id, supplier_id, amount, currency, rate, spent_on,
--     account_id | null (pendiente), due_date (si pendiente), note,
--     receipt_path, branch_id, recurring_id}
CREATE OR REPLACE FUNCTION public.create_expense(p jsonb)
RETURNS expenses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid := public.current_business_id();
  e expenses%ROWTYPE;
  a bank_accounts%ROWTYPE;
  r recurring_expenses%ROWTYPE;
  v_amount numeric := round(COALESCE(NULLIF(p->>'amount', '')::numeric, 0), 2);
  v_currency text := COALESCE(NULLIF(p->>'currency', ''), 'USD');
  v_rate numeric := COALESCE(NULLIF(p->>'rate', '')::numeric, 0);
  v_usd numeric;
  v_branch uuid;
  v_supplier suppliers%ROWTYPE;
  v_pending boolean := NULLIF(p->>'account_id', '') IS NULL;
BEGIN
  IF NOT public.has_module_perm('expenses') THEN RAISE EXCEPTION 'No tienes permiso para registrar gastos'; END IF;
  IF b_id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  IF btrim(COALESCE(p->>'name', '')) = '' THEN RAISE EXCEPTION 'Escribe el nombre del gasto'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor que cero'; END IF;
  IF v_currency NOT IN ('USD', 'VES') THEN RAISE EXCEPTION 'Moneda inválida'; END IF;
  IF v_currency = 'VES' AND v_rate <= 0 THEN RAISE EXCEPTION 'Falta la tasa de cambio'; END IF;
  v_usd := CASE WHEN v_currency = 'USD' THEN v_amount ELSE round(v_amount / v_rate, 2) END;

  v_branch := NULLIF(p->>'branch_id', '')::uuid;
  IF v_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches WHERE id = v_branch AND business_id = b_id) THEN
    v_branch := NULL;
  END IF;
  v_branch := COALESCE(v_branch, public.default_branch_id(b_id));

  IF NULLIF(p->>'category_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM expense_categories WHERE id = (p->>'category_id')::uuid AND business_id = b_id
  ) THEN RAISE EXCEPTION 'Categoría no encontrada'; END IF;

  IF NULLIF(p->>'supplier_id', '') IS NOT NULL THEN
    SELECT * INTO v_supplier FROM suppliers WHERE id = (p->>'supplier_id')::uuid AND business_id = b_id;
    IF v_supplier.id IS NULL THEN RAISE EXCEPTION 'Proveedor no encontrado'; END IF;
  END IF;

  IF NOT v_pending THEN
    SELECT * INTO a FROM bank_accounts WHERE id = (p->>'account_id')::uuid AND business_id = b_id;
    IF a.id IS NULL THEN RAISE EXCEPTION 'Cuenta no encontrada'; END IF;
  ELSIF NULLIF(p->>'due_date', '') IS NULL THEN
    RAISE EXCEPTION 'Indica cuándo vence el pago pendiente';
  END IF;

  IF NULLIF(p->>'recurring_id', '') IS NOT NULL THEN
    SELECT * INTO r FROM recurring_expenses WHERE id = (p->>'recurring_id')::uuid AND business_id = b_id FOR UPDATE;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Gasto fijo no encontrado'; END IF;
  END IF;

  -- Si el pago sale de otra moneda que la del gasto, se convierte.
  INSERT INTO expenses (business_id, branch_id, kind, name, category_id, supplier_id, supplier_name,
                        amount, currency, rate, amount_usd, spent_on, status, account_id, account_name,
                        recurring_id, receipt_path, note, created_by)
  VALUES (b_id, v_branch, CASE WHEN r.id IS NOT NULL OR p->>'kind' = 'fixed' THEN 'fixed' ELSE 'variable' END,
          btrim(p->>'name'), NULLIF(p->>'category_id', '')::uuid, v_supplier.id, COALESCE(v_supplier.name, ''),
          v_amount, v_currency, v_rate, v_usd, COALESCE(NULLIF(p->>'spent_on', '')::date, current_date),
          CASE WHEN v_pending THEN 'pending' ELSE 'paid' END, a.id, COALESCE(a.name, ''),
          r.id, COALESCE(p->>'receipt_path', ''), btrim(COALESCE(p->>'note', '')), auth.uid())
  RETURNING * INTO e;

  IF v_pending THEN
    INSERT INTO debts (business_id, branch_id, kind, party_type, supplier_id, party_name, concept,
                       amount_usd, issue_date, due_date, expense_id, created_by)
    VALUES (b_id, v_branch, 'payable', CASE WHEN v_supplier.id IS NULL THEN 'other' ELSE 'supplier' END,
            v_supplier.id, COALESCE(v_supplier.name, e.name), 'Gasto: ' || e.name,
            v_usd, e.spent_on, (p->>'due_date')::date, e.id, auth.uid());
  ELSE
    UPDATE expenses SET cash_movement_id = public.auto_cash_movement(b_id, v_branch, a, 'out',
        CASE WHEN a.currency = v_currency THEN v_amount
             WHEN a.currency = 'USD' THEN v_usd
             ELSE round(v_usd * v_rate, 2) END,
        'Gasto: ' || e.name)
     WHERE id = e.id RETURNING * INTO e;
  END IF;

  IF r.id IS NOT NULL THEN
    UPDATE recurring_expenses SET next_due = public.next_due_date(next_due, frequency) WHERE id = r.id;
  END IF;
  RETURN e;
END $$;

-- Borrar un gasto: devuelve la plata a la caja si sigue abierta y borra su
-- cuenta por pagar (si no tiene abonos).
CREATE OR REPLACE FUNCTION public.delete_expense(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e expenses%ROWTYPE;
  m cash_movements%ROWTYPE;
BEGIN
  IF NOT public.has_module_perm('expenses') THEN RAISE EXCEPTION 'No tienes permiso para borrar gastos'; END IF;
  SELECT * INTO e FROM expenses WHERE id = p_id AND business_id = public.current_business_id();
  IF e.id IS NULL THEN RAISE EXCEPTION 'Gasto no encontrado'; END IF;
  IF EXISTS (SELECT 1 FROM debts d JOIN debt_payments dp ON dp.debt_id = d.id WHERE d.expense_id = e.id) THEN
    RAISE EXCEPTION 'Este gasto ya tiene pagos registrados en Cuentas; bórralos primero';
  END IF;
  DELETE FROM debts WHERE expense_id = e.id;
  IF e.cash_movement_id IS NOT NULL THEN
    SELECT * INTO m FROM cash_movements WHERE id = e.cash_movement_id;
    PERFORM public.undo_cash_movement(m.id, m.amount);
  END IF;
  DELETE FROM expenses WHERE id = e.id;
END $$;

-- =====================================================================
-- RLS
-- =====================================================================
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_payments ENABLE ROW LEVEL SECURITY;

-- Lectura: quien es del negocio y tiene el módulo.
DROP POLICY IF EXISTS expense_categories_select ON expense_categories;
CREATE POLICY expense_categories_select ON expense_categories FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS expense_categories_write ON expense_categories;
CREATE POLICY expense_categories_write ON expense_categories FOR ALL TO authenticated
  USING (business_id = public.current_business_id() AND public.has_module_perm('expenses'))
  WITH CHECK (business_id = public.current_business_id() AND public.has_module_perm('expenses'));

DROP POLICY IF EXISTS recurring_expenses_select ON recurring_expenses;
CREATE POLICY recurring_expenses_select ON recurring_expenses FOR SELECT TO authenticated
  USING ((business_id = public.current_business_id() AND public.has_module_perm('expenses')) OR public.is_platform_admin());
DROP POLICY IF EXISTS recurring_expenses_write ON recurring_expenses;
CREATE POLICY recurring_expenses_write ON recurring_expenses FOR ALL TO authenticated
  USING (business_id = public.current_business_id() AND public.has_module_perm('expenses'))
  WITH CHECK (business_id = public.current_business_id() AND public.has_module_perm('expenses'));

-- Gastos: se crean y borran por función; se editan los datos descriptivos.
DROP POLICY IF EXISTS expenses_select ON expenses;
CREATE POLICY expenses_select ON expenses FOR SELECT TO authenticated
  USING ((business_id = public.current_business_id() AND public.has_module_perm('expenses')) OR public.is_platform_admin());
DROP POLICY IF EXISTS expenses_update ON expenses;
CREATE POLICY expenses_update ON expenses FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id() AND public.has_module_perm('expenses'))
  WITH CHECK (business_id = public.current_business_id() AND public.has_module_perm('expenses'));

-- Solo los datos descriptivos se editan directo; montos, cuentas y estado,
-- por las funciones.
CREATE OR REPLACE FUNCTION public.trg_expense_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'authenticated' AND (
     NEW.amount <> OLD.amount OR NEW.currency <> OLD.currency OR NEW.amount_usd <> OLD.amount_usd
     OR NEW.rate <> OLD.rate OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.status <> OLD.status OR NEW.business_id <> OLD.business_id
     OR NEW.cash_movement_id IS DISTINCT FROM OLD.cash_movement_id) THEN
    RAISE EXCEPTION 'Para cambiar el monto o la cuenta, borra el gasto y regístralo de nuevo';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_expense_guard ON expenses;
CREATE TRIGGER trg_expense_guard BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_expense_guard();

DROP POLICY IF EXISTS debts_select ON debts;
CREATE POLICY debts_select ON debts FOR SELECT TO authenticated
  USING ((business_id = public.current_business_id() AND public.has_module_perm('accounts')) OR public.is_platform_admin());
DROP POLICY IF EXISTS debt_payments_select ON debt_payments;
CREATE POLICY debt_payments_select ON debt_payments FOR SELECT TO authenticated
  USING ((business_id = public.current_business_id() AND public.has_module_perm('accounts')) OR public.is_platform_admin());

-- ---------- Comprobantes de gastos (privados, carpeta = negocio) ----------
INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "expense receipts read" ON storage.objects;
CREATE POLICY "expense receipts read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'expense-receipts'
         AND (storage.foldername(name))[1] = public.current_business_id()::text
         AND public.has_module_perm('expenses'));
DROP POLICY IF EXISTS "expense receipts insert" ON storage.objects;
CREATE POLICY "expense receipts insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-receipts'
              AND (storage.foldername(name))[1] = public.current_business_id()::text
              AND public.has_module_perm('expenses'));
DROP POLICY IF EXISTS "expense receipts delete" ON storage.objects;
CREATE POLICY "expense receipts delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'expense-receipts'
         AND (storage.foldername(name))[1] = public.current_business_id()::text
         AND public.has_module_perm('expenses'));

GRANT EXECUTE ON FUNCTION public.create_debt(text, text, uuid, uuid, text, text, numeric, date, date, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_debt(uuid, text, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_debt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_debts(uuid[], uuid, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_debt_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_expense(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expense(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_cash_movement(uuid, uuid, bank_accounts, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.undo_cash_movement(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_expense_categories(uuid) FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- Venta a crédito
-- =====================================================================
DROP FUNCTION IF EXISTS public.create_order(jsonb, jsonb, numeric, text, text, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.create_order(
  p_items jsonb, p_payments jsonb, p_rate numeric, p_rate_source text,
  p_customer_name text, p_note text, p_customer_id uuid DEFAULT NULL, p_branch_id uuid DEFAULT NULL,
  p_credit_due date DEFAULT NULL
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
    offer := NULLIF(COALESCE(prod.offer_percent, 0), 0);
    offer_fixed := NULLIF(COALESCE(prod.offer_price, 0), 0);
    IF offer_fixed IS NOT NULL THEN
      unit_price := offer_fixed;
      offer := NULL;
    ELSIF offer IS NOT NULL THEN
      unit_price := round(unit_price * (1 - offer / 100.0), 2);
    END IF;
    line_total := round(unit_price * qty, 2);
    v_total := v_total + line_total;

    SELECT string_agg(value, ' · ' ORDER BY key) INTO v_label
      FROM jsonb_each_text(var.attributes);

    INSERT INTO order_items (order_id, product_id, variant_id, name, variant_label,
                             unit, quantity, unit_price_usd, unit_cost_usd, offer_percent, offer_price, line_total_usd)
    VALUES (o.id, prod.id, var.id, prod.name, COALESCE(v_label, ''),
            prod.unit, qty, unit_price, COALESCE(var.cost, prod.cost, 0), offer, offer_fixed, line_total);

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
      pay_kind := COALESCE(pm.kind, 'normal');

      IF pay_currency = 'USD' THEN
        pay_amount_usd := pay_amount;
      ELSE
        pay_amount_usd := round(pay_amount / p_rate, 2);
      END IF;

      -- El descuento por pago en divisa premia el efectivo en dólares. Lo que
      -- financia Cashea llega por transferencia y en cuotas, así que no lo
      -- gana aunque el método esté en una cuenta en USD.
      IF pay_currency = 'USD' AND pay_kind <> 'cashea' THEN
        v_usd := v_usd + pay_amount;
      ELSE
        v_ves := v_ves + pay_amount_usd;
      END IF;

      INSERT INTO order_payments (order_id, method_id, method_name, account_id, account_name, currency, amount, amount_usd, kind)
      VALUES (o.id, pm.id, COALESCE(pm.name, pay->>'method_name', ''),
              ba.id, COALESCE(ba.name, pay->>'account_name', 'Pago'),
              pay_currency, pay_amount, pay_amount_usd, pay_kind);
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
    -- Venta a crédito: lo que no se cobró queda como cuenta por cobrar del
    -- cliente. Sin cliente o sin fecha de vencimiento no se puede fiar.
    IF p_credit_due IS NULL THEN
      RAISE EXCEPTION 'Payments (%) do not cover the order total (%)', round(covered, 2), round(v_total, 2);
    END IF;
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'Para vender a crédito hay que elegir el cliente';
    END IF;
    v_credit := round(v_total - covered, 2);
  END IF;

  UPDATE orders SET total_usd = v_total, total_ves = round(v_total * p_rate, 2), discount_usd = v_disc,
                    credit_usd = v_credit
   WHERE id = o.id RETURNING * INTO o;

  IF v_credit > 0 THEN
    INSERT INTO debts (business_id, branch_id, kind, party_type, customer_id, party_name,
                       concept, amount_usd, issue_date, due_date, order_id, created_by)
    VALUES (b.id, br, 'receivable', 'customer', p_customer_id, v_name,
            'Venta Nº ' || o.number, v_credit, current_date, p_credit_due, o.id, auth.uid());
  END IF;
  RETURN o;
END $$;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, numeric, text, text, text, uuid, uuid, date) TO authenticated;
