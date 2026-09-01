/*
# Permisos por módulo para el personal

El admin del negocio puede dar (y quitar) a una vendedora acceso a módulos
que normalmente son solo de administrador: inventory, stats, retentions.

- profiles.permissions: {"inventory": true, ...} — solo aplica a business_role
  'seller' (el admin ya tiene todo). La UI y las rutas lo respetan; el RLS de
  productos/movimientos ya era por negocio, no por rol.
- set_staff_permissions(user, permissions): SECURITY DEFINER, solo el admin
  del negocio sobre miembros de su propio negocio (mismo patrón que
  set_staff_role); valida las claves permitidas.
- Endurecimiento de profiles_update_own: el WITH CHECK original solo fijaba
  role; un usuario podía editarse business_role, business_id o (ahora)
  permissions con un UPDATE directo. Se fijan los cuatro campos; los cambios
  legítimos van por las funciones SECURITY DEFINER o el service role.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}';

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
    IF k NOT IN ('inventory', 'stats', 'retentions') THEN
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

GRANT EXECUTE ON FUNCTION public.set_staff_permissions(uuid, jsonb) TO authenticated;

DROP POLICY IF EXISTS profiles_update_own ON profiles;
CREATE POLICY profiles_update_own ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid()
    AND role = (SELECT role FROM profiles WHERE id = auth.uid())
    AND business_role = (SELECT business_role FROM profiles WHERE id = auth.uid())
    AND business_id IS NOT DISTINCT FROM (SELECT business_id FROM profiles WHERE id = auth.uid())
    AND permissions = (SELECT permissions FROM profiles WHERE id = auth.uid()));
