/*
# Acceso por sucursal, aplicado en la base de datos

Hasta ahora el acceso por sucursal (profiles.all_branches + user_branches) solo
filtraba el selector de sucursal en la app: un usuario limitado seguía leyendo
ventas, gastos y deudas de todas las sucursales, y el servidor aceptaba que
registrara en cualquiera. Desde aquí:

- can_access_branch(id): regla única de acceso. Ven todas las sucursales los
  administradores del negocio, el admin de plataforma y quien tenga
  all_branches. Los demás, solo las de user_branches; si no tienen ninguna
  activa asignada, la sucursal por defecto (igual que la app: nunca queda sin
  sucursal). Lo que no tiene sucursal (branch_id NULL) sigue visible.
- Lectura (RLS): ventas (y por arrastre sus artículos y pagos), movimientos de
  inventario, gastos y fijos, deudas y sus abonos, y sesiones de caja (y sus
  líneas) se filtran por sucursal. El stock por sucursal sigue visible para
  poder trasladar.
- Escritura (triggers): insertar, cambiar o borrar en esas tablas exige acceso
  a la sucursal de la fila. Al ser triggers, cubren tanto los inserts directos
  como las funciones del servidor (create_order, open_cash_session, etc.).
  Sin sesión de usuario (tareas internas) no se bloquea.
- transfer_stock(): exige acceso a la sucursal de ORIGEN; el destino puede ser
  cualquiera del negocio (enviar mercancía a otra sucursal).
*/

-- ---------- Regla de acceso ----------
CREATE OR REPLACE FUNCTION public.can_access_branch(p_branch uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_branch IS NULL
      OR auth.uid() IS NULL
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
                  AND (p.role = 'platform_admin' OR p.business_role = 'admin' OR p.all_branches))
      OR EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = auth.uid() AND ub.branch_id = p_branch)
      OR (NOT EXISTS (SELECT 1 FROM user_branches ub JOIN branches b ON b.id = ub.branch_id AND b.active
                       WHERE ub.user_id = auth.uid())
          AND p_branch = public.default_branch_id((SELECT business_id FROM branches WHERE id = p_branch)));
$$;
GRANT EXECUTE ON FUNCTION public.can_access_branch(uuid) TO authenticated;

-- ---------- Lectura ----------
DROP POLICY IF EXISTS orders_select ON orders;
CREATE POLICY orders_select ON orders FOR SELECT TO authenticated
  USING ((business_id = current_business_id() AND can_access_branch(branch_id)) OR is_platform_admin());
DROP POLICY IF EXISTS orders_delete ON orders;
CREATE POLICY orders_delete ON orders FOR DELETE TO authenticated
  USING (business_id = current_business_id() AND can_access_branch(branch_id));

DROP POLICY IF EXISTS movements_select ON inventory_movements;
CREATE POLICY movements_select ON inventory_movements FOR SELECT TO authenticated
  USING ((business_id = current_business_id() AND can_access_branch(branch_id)) OR is_platform_admin());

DROP POLICY IF EXISTS expenses_select ON expenses;
CREATE POLICY expenses_select ON expenses FOR SELECT TO authenticated
  USING ((business_id = current_business_id() AND has_module_perm('expenses') AND can_access_branch(branch_id))
         OR is_platform_admin());
DROP POLICY IF EXISTS expenses_update ON expenses;
CREATE POLICY expenses_update ON expenses FOR UPDATE TO authenticated
  USING (business_id = current_business_id() AND has_module_perm('expenses') AND can_access_branch(branch_id))
  WITH CHECK (business_id = current_business_id() AND has_module_perm('expenses') AND can_access_branch(branch_id));

DROP POLICY IF EXISTS recurring_expenses_select ON recurring_expenses;
CREATE POLICY recurring_expenses_select ON recurring_expenses FOR SELECT TO authenticated
  USING ((business_id = current_business_id() AND has_module_perm('expenses') AND can_access_branch(branch_id))
         OR is_platform_admin());
DROP POLICY IF EXISTS recurring_expenses_write ON recurring_expenses;
CREATE POLICY recurring_expenses_write ON recurring_expenses FOR ALL TO authenticated
  USING (business_id = current_business_id() AND has_module_perm('expenses') AND can_access_branch(branch_id))
  WITH CHECK (business_id = current_business_id() AND has_module_perm('expenses') AND can_access_branch(branch_id));

DROP POLICY IF EXISTS debts_select ON debts;
CREATE POLICY debts_select ON debts FOR SELECT TO authenticated
  USING ((business_id = current_business_id() AND has_module_perm('accounts') AND can_access_branch(branch_id))
         OR is_platform_admin());
DROP POLICY IF EXISTS debt_payments_select ON debt_payments;
CREATE POLICY debt_payments_select ON debt_payments FOR SELECT TO authenticated
  USING ((business_id = current_business_id() AND has_module_perm('accounts')
          AND EXISTS (SELECT 1 FROM debts d WHERE d.id = debt_payments.debt_id))
         OR is_platform_admin());

DROP POLICY IF EXISTS cash_sessions_select ON cash_sessions;
CREATE POLICY cash_sessions_select ON cash_sessions FOR SELECT TO authenticated
  USING ((business_id = current_business_id() AND can_access_branch(branch_id)) OR is_platform_admin());

-- ---------- Escritura ----------
CREATE OR REPLACE FUNCTION public.guard_branch_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('zt.branch_guard_off', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND NOT public.can_access_branch(OLD.branch_id) THEN
    RAISE EXCEPTION 'No tienes acceso a esta sucursal';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NOT public.can_access_branch(NEW.branch_id) THEN
    RAISE EXCEPTION 'No tienes acceso a esta sucursal';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- "zz_" para correr después de los BEFORE que completan la sucursal por defecto.
DROP TRIGGER IF EXISTS zz_branch_guard ON orders;
CREATE TRIGGER zz_branch_guard BEFORE INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_branch_access();
DROP TRIGGER IF EXISTS zz_branch_guard ON inventory_movements;
CREATE TRIGGER zz_branch_guard BEFORE INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.guard_branch_access();
DROP TRIGGER IF EXISTS zz_branch_guard ON expenses;
CREATE TRIGGER zz_branch_guard BEFORE INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION public.guard_branch_access();
DROP TRIGGER IF EXISTS zz_branch_guard ON recurring_expenses;
CREATE TRIGGER zz_branch_guard BEFORE INSERT OR UPDATE OR DELETE ON recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION public.guard_branch_access();
DROP TRIGGER IF EXISTS zz_branch_guard ON debts;
CREATE TRIGGER zz_branch_guard BEFORE INSERT OR UPDATE OR DELETE ON debts
  FOR EACH ROW EXECUTE FUNCTION public.guard_branch_access();
DROP TRIGGER IF EXISTS zz_branch_guard ON cash_sessions;
CREATE TRIGGER zz_branch_guard BEFORE INSERT OR UPDATE OR DELETE ON cash_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_branch_access();

-- ---------- Traslados: acceso al origen; el destino puede ser cualquiera ----------
CREATE OR REPLACE FUNCTION public.transfer_stock(p_variant_id uuid, p_from uuid, p_to uuid, p_qty numeric, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bid uuid := public.current_business_id();
  prod uuid;
BEGIN
  IF NOT public.has_inventory_perm('inv_edit_stock') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar cantidades';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'Origen y destino no pueden ser la misma sucursal'; END IF;
  SELECT product_id INTO prod FROM product_variants WHERE id = p_variant_id AND business_id = bid;
  IF prod IS NULL THEN RAISE EXCEPTION 'Variant not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_from AND business_id = bid) THEN RAISE EXCEPTION 'Origen no válido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_to AND business_id = bid) THEN RAISE EXCEPTION 'Destino no válido'; END IF;
  IF NOT public.can_access_branch(p_from) THEN RAISE EXCEPTION 'No tienes acceso a la sucursal de origen'; END IF;

  INSERT INTO inventory_movements (business_id, product_id, variant_id, branch_id, type, quantity, note, created_by)
    VALUES (bid, prod, p_variant_id, p_from, 'out', p_qty, COALESCE(NULLIF(p_note, ''), 'Traslado'), auth.uid());
  PERFORM set_config('zt.branch_guard_off', 'on', true);
  INSERT INTO inventory_movements (business_id, product_id, variant_id, branch_id, type, quantity, note, created_by)
    VALUES (bid, prod, p_variant_id, p_to, 'in', p_qty, COALESCE(NULLIF(p_note, ''), 'Traslado'), auth.uid());
  PERFORM set_config('zt.branch_guard_off', 'off', true);
END $$;
