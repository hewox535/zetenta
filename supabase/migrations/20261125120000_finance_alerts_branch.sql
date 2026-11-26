/*
# Avisos del menú por sucursal

finance_alerts() alimenta los globos rojos del menú (cuentas y gastos fijos que
vencen en 3 días o ya vencieron). Corre como SECURITY DEFINER, así que no pasaba
por el filtro de sucursal de 20261122120000_branch_access_enforced.sql: una
vendedora limitada veía los avisos de todas las sucursales. Ahora solo cuenta
los de las sucursales a las que tiene acceso (can_access_branch).
*/
CREATE OR REPLACE FUNCTION public.finance_alerts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'debts', (SELECT count(*) FROM debts
               WHERE business_id = public.current_business_id() AND cancelled_at IS NULL
                 AND amount_usd - paid_usd > 0.004 AND due_date IS NOT NULL
                 AND due_date <= current_date + 3
                 AND public.can_access_branch(branch_id)),
    'recurring', (SELECT count(*) FROM recurring_expenses
                   WHERE business_id = public.current_business_id() AND active
                     AND next_due <= current_date + 3
                     AND public.can_access_branch(branch_id))
  )
$$;
GRANT EXECUTE ON FUNCTION public.finance_alerts() TO authenticated;
