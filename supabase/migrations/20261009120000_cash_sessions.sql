/*
# Caja: apertura, retiros y cierre diario (arqueo)

El negocio necesita cuadrar la caja al final del día: saber cuánto debería
haber según lo vendido, contar lo que hay de verdad y dejar constancia de la
diferencia.

Se trabaja por turnos de caja, uno por sucursal:

- Se ABRE la caja declarando el fondo inicial de cada cuenta de efectivo
  (lo que queda del día anterior, el sencillo para dar vuelto).
- Durante el turno, cada venta queda amarrada a la caja abierta de su
  sucursal (lo hace un trigger, así entra venga de donde venga), y se pueden
  anotar movimientos de efectivo que no son ventas: un retiro del dueño, un
  gasto, un aporte.
- Se CIERRA contando lo que hay. El sistema calcula lo esperado
  (fondo + ventas + aportes − retiros) y guarda las dos cifras y su
  diferencia, congeladas.

- cash_sessions: el turno. Solo puede haber uno abierto por sucursal.
- cash_session_lines: una fila por cuenta (Efectivo $, Pago móvil, Cashea…)
  con el fondo, lo vendido, los movimientos, lo esperado y lo contado. Las
  cuentas que no son efectivo también quedan registradas, como referencia de
  lo que entró por ese medio; no se cuentan.
- cash_movements: los retiros y aportes del turno.
- bank_accounts.is_cash: qué cuentas son dinero en mano y por lo tanto se
  cuentan en el arqueo. Se marca sola en las que ya se llaman "efectivo" o
  "caja"; el resto se activa desde Negocio → Cuentas.

El cierre NO bloquea nada: una venta de un día ya cerrado se puede seguir
cancelando con su PIN. El arqueo guarda las cifras tal como estaban al
cerrarlo, así que el papel del cierre no cambia después.

Las cifras se guardan en la moneda de cada cuenta. La tasa del cierre queda
en cash_sessions.rate solo para poder expresar un total en dólares.
*/

-- ---------- Qué cuentas son dinero en mano ----------
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS is_cash boolean NOT NULL DEFAULT false;
UPDATE bank_accounts SET is_cash = true
 WHERE is_cash = false AND (name ILIKE '%efectivo%' OR name ILIKE '%caja%');

-- ---------- El turno de caja ----------
CREATE TABLE IF NOT EXISTS cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  branch_name text NOT NULL DEFAULT '',
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  open_note text NOT NULL DEFAULT '',
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  close_note text NOT NULL DEFAULT '',
  rate numeric(18,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Una sola caja abierta por sucursal. El COALESCE cubre el negocio sin
-- sucursales, donde branch_id viene en NULL y un índice normal no lo
-- consideraría repetido.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cash_session_open
  ON cash_sessions (business_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cash_sessions_business ON cash_sessions (business_id, opened_at DESC);

-- ---------- El arqueo, cuenta por cuenta ----------
CREATE TABLE IF NOT EXISTS cash_session_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  account_name text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'VES' CHECK (currency IN ('USD', 'VES')),
  is_cash boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  opening numeric(18,2) NOT NULL DEFAULT 0,   -- fondo declarado al abrir
  sales numeric(18,2) NOT NULL DEFAULT 0,     -- congelado al cerrar
  moves_in numeric(18,2) NOT NULL DEFAULT 0,
  moves_out numeric(18,2) NOT NULL DEFAULT 0,
  expected numeric(18,2) NOT NULL DEFAULT 0,
  counted numeric(18,2),                      -- NULL: cuenta que no se cuenta
  UNIQUE (session_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_cash_lines_session ON cash_session_lines (session_id);

-- ---------- Plata que entra o sale sin ser una venta ----------
CREATE TABLE IF NOT EXISTS cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  account_name text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'VES' CHECK (currency IN ('USD', 'VES')),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements (session_id, created_at);

-- ---------- Cada venta, a la caja que estaba abierta ----------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_session_id uuid REFERENCES cash_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_cash_session ON orders (cash_session_id);

CREATE OR REPLACE FUNCTION public.set_order_cash_session()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.cash_session_id IS NULL THEN
    SELECT id INTO NEW.cash_session_id FROM cash_sessions
     WHERE business_id = NEW.business_id
       AND closed_at IS NULL
       AND branch_id IS NOT DISTINCT FROM NEW.branch_id
     LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_order_cash_session ON orders;
CREATE TRIGGER trg_order_cash_session BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION public.set_order_cash_session();

-- ---------- Permiso de caja ----------
CREATE OR REPLACE FUNCTION public.has_cash_perm()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.id = auth.uid()
       AND (p.role = 'platform_admin' OR p.business_role = 'admin'
            OR COALESCE((p.permissions ->> 'cash')::boolean, false))
  )
$$;

-- set_staff_permissions: se suma la clave 'cash' a las que ya acepta.
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
    IF k NOT IN ('inventory', 'stats', 'retentions', 'cash',
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

-- El módulo se activa junto con el de ventas: quien vende, tiene caja.
UPDATE businesses
   SET capabilities = capabilities || jsonb_build_object('cash', COALESCE((capabilities ->> 'orders')::boolean, false))
 WHERE NOT (capabilities ? 'cash');

-- ---------- Lo que lleva la caja hasta ahora ----------
-- Devuelve, por cuenta, el fondo con el que se abrió, lo vendido por ese
-- medio y los movimientos. Es la misma cuenta que congela el cierre, para que
-- lo que el cajero ve antes de cerrar sea exactamente lo que queda guardado.
CREATE OR REPLACE FUNCTION public.cash_session_report(p_session_id uuid)
RETURNS TABLE (
  account_id uuid, account_name text, currency text, is_cash boolean, sort_order integer,
  opening numeric, sales numeric, moves_in numeric, moves_out numeric, expected numeric, counted numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT * FROM cash_sessions
     WHERE id = p_session_id AND business_id = public.current_business_id()
  ),
  ventas AS (
    SELECT op.account_id, sum(op.amount) AS total
      FROM order_payments op
      JOIN orders o ON o.id = op.order_id
     WHERE o.cash_session_id = p_session_id AND o.cancelled_at IS NULL
     GROUP BY op.account_id
  ),
  movs AS (
    SELECT m.account_id,
           sum(m.amount) FILTER (WHERE m.direction = 'in') AS entra,
           sum(m.amount) FILTER (WHERE m.direction = 'out') AS sale
      FROM cash_movements m
     WHERE m.session_id = p_session_id
     GROUP BY m.account_id
  )
  SELECT l.account_id, l.account_name, l.currency, l.is_cash, l.sort_order,
         l.opening,
         COALESCE(v.total, 0) AS sales,
         COALESCE(mv.entra, 0) AS moves_in,
         COALESCE(mv.sale, 0) AS moves_out,
         l.opening + COALESCE(v.total, 0) + COALESCE(mv.entra, 0) - COALESCE(mv.sale, 0) AS expected,
         l.counted
    FROM s
    JOIN cash_session_lines l ON l.session_id = s.id
    LEFT JOIN ventas v ON v.account_id = l.account_id
    LEFT JOIN movs mv ON mv.account_id = l.account_id
   ORDER BY l.is_cash DESC, l.sort_order, l.account_name
$$;

-- ---------- Abrir la caja ----------
-- p_opening: [{"account_id": "...", "amount": 12.5}] — solo hace falta
-- declarar el fondo de las cuentas de efectivo; el resto queda en 0.
CREATE OR REPLACE FUNCTION public.open_cash_session(
  p_branch_id uuid DEFAULT NULL, p_opening jsonb DEFAULT '[]'::jsonb, p_note text DEFAULT ''
) RETURNS cash_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
  br_id uuid;
  br_name text := '';
  s cash_sessions%ROWTYPE;
BEGIN
  IF NOT public.has_cash_perm() THEN
    RAISE EXCEPTION 'No tienes permiso para abrir la caja';
  END IF;
  b_id := public.current_business_id();
  IF b_id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;

  br_id := p_branch_id;
  IF br_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches WHERE id = br_id AND business_id = b_id) THEN
    RAISE EXCEPTION 'Esa sucursal no es de tu negocio';
  END IF;
  IF br_id IS NULL THEN br_id := public.default_branch_id(b_id); END IF;
  SELECT name INTO br_name FROM branches WHERE id = br_id;

  IF EXISTS (
    SELECT 1 FROM cash_sessions
     WHERE business_id = b_id AND closed_at IS NULL AND branch_id IS NOT DISTINCT FROM br_id
  ) THEN
    RAISE EXCEPTION 'La caja de esa sucursal ya está abierta';
  END IF;

  INSERT INTO cash_sessions (business_id, branch_id, branch_name, opened_by, open_note)
  VALUES (b_id, br_id, COALESCE(br_name, ''), auth.uid(), COALESCE(btrim(p_note), ''))
  RETURNING * INTO s;

  -- Una línea por cuenta activa: así el arqueo refleja el negocio tal como
  -- estaba al abrir, aunque después se agregue o se borre una cuenta.
  INSERT INTO cash_session_lines (session_id, account_id, account_name, currency, is_cash, sort_order, opening)
  SELECT s.id, a.id, a.name, a.currency, a.is_cash, a.sort_order,
         COALESCE((
           SELECT (x ->> 'amount')::numeric FROM jsonb_array_elements(COALESCE(p_opening, '[]'::jsonb)) x
            WHERE (x ->> 'account_id')::uuid = a.id
         ), 0)
    FROM bank_accounts a
   WHERE a.business_id = b_id AND a.active;

  RETURN s;
END $$;

-- ---------- Anotar un retiro o un aporte ----------
CREATE OR REPLACE FUNCTION public.add_cash_movement(
  p_session_id uuid, p_account_id uuid, p_direction text, p_amount numeric, p_reason text DEFAULT ''
) RETURNS cash_movements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
  s cash_sessions%ROWTYPE;
  a bank_accounts%ROWTYPE;
  m cash_movements%ROWTYPE;
BEGIN
  IF NOT public.has_cash_perm() THEN
    RAISE EXCEPTION 'No tienes permiso para mover la caja';
  END IF;
  b_id := public.current_business_id();
  SELECT * INTO s FROM cash_sessions WHERE id = p_session_id AND business_id = b_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Caja no encontrada'; END IF;
  IF s.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Esa caja ya está cerrada'; END IF;
  IF p_direction NOT IN ('in', 'out') THEN RAISE EXCEPTION 'Movimiento inválido'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor que cero'; END IF;

  SELECT * INTO a FROM bank_accounts WHERE id = p_account_id AND business_id = b_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Cuenta no encontrada'; END IF;

  INSERT INTO cash_movements (business_id, session_id, account_id, account_name, currency,
                              direction, amount, reason, created_by)
  VALUES (b_id, s.id, a.id, a.name, a.currency, p_direction, round(p_amount, 2),
          COALESCE(btrim(p_reason), ''), auth.uid())
  RETURNING * INTO m;
  RETURN m;
END $$;

CREATE OR REPLACE FUNCTION public.delete_cash_movement(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m cash_movements%ROWTYPE;
BEGIN
  IF NOT public.has_cash_perm() THEN
    RAISE EXCEPTION 'No tienes permiso para mover la caja';
  END IF;
  SELECT * INTO m FROM cash_movements
   WHERE id = p_id AND business_id = public.current_business_id();
  IF m.id IS NULL THEN RAISE EXCEPTION 'Movimiento no encontrado'; END IF;
  IF EXISTS (SELECT 1 FROM cash_sessions WHERE id = m.session_id AND closed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'La caja ya está cerrada; ese movimiento no se puede borrar';
  END IF;
  DELETE FROM cash_movements WHERE id = p_id;
END $$;

-- ---------- Cerrar la caja ----------
-- p_counted: [{"account_id": "...", "amount": 118.5}] con lo que se contó de
-- verdad. Lo que no venga queda sin contar (NULL) y no genera diferencia.
CREATE OR REPLACE FUNCTION public.close_cash_session(
  p_session_id uuid, p_counted jsonb DEFAULT '[]'::jsonb,
  p_rate numeric DEFAULT 0, p_note text DEFAULT ''
) RETURNS cash_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
  s cash_sessions%ROWTYPE;
BEGIN
  IF NOT public.has_cash_perm() THEN
    RAISE EXCEPTION 'No tienes permiso para cerrar la caja';
  END IF;
  b_id := public.current_business_id();
  SELECT * INTO s FROM cash_sessions WHERE id = p_session_id AND business_id = b_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Caja no encontrada'; END IF;
  IF s.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Esa caja ya está cerrada'; END IF;

  -- Se congelan las cifras: después de esto el papel del cierre ya no cambia,
  -- aunque más adelante se cancele una venta de ese turno.
  UPDATE cash_session_lines l
     SET sales = r.sales, moves_in = r.moves_in, moves_out = r.moves_out, expected = r.expected,
         counted = CASE WHEN l.is_cash THEN (
           SELECT round((x ->> 'amount')::numeric, 2)
             FROM jsonb_array_elements(COALESCE(p_counted, '[]'::jsonb)) x
            WHERE (x ->> 'account_id')::uuid = l.account_id
         ) END
    FROM public.cash_session_report(p_session_id) r
   WHERE l.session_id = p_session_id AND l.account_id IS NOT DISTINCT FROM r.account_id;

  UPDATE cash_sessions
     SET closed_at = now(), closed_by = auth.uid(),
         close_note = COALESCE(btrim(p_note), ''), rate = COALESCE(p_rate, 0)
   WHERE id = p_session_id
   RETURNING * INTO s;
  RETURN s;
END $$;

-- ---------- RLS ----------
-- Se lee desde la app; escribir es solo por las funciones de arriba.
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_session_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_sessions_select ON cash_sessions;
CREATE POLICY cash_sessions_select ON cash_sessions FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS cash_lines_select ON cash_session_lines;
CREATE POLICY cash_lines_select ON cash_session_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM cash_sessions s WHERE s.id = session_id
     AND (s.business_id = public.current_business_id() OR public.is_platform_admin())
  ));

DROP POLICY IF EXISTS cash_movements_select ON cash_movements;
CREATE POLICY cash_movements_select ON cash_movements FOR SELECT TO authenticated
  USING (business_id = public.current_business_id() OR public.is_platform_admin());

GRANT EXECUTE ON FUNCTION public.has_cash_perm() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_session_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_session(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_cash_movement(uuid, uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_cash_movement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_session(uuid, jsonb, numeric, text) TO authenticated;
