/*
# Sesiones abiertas del negocio

El administrador del negocio ve qué usuarios de su negocio tienen sesión
abierta y en qué dispositivo (navegador/sistema, IP, última actividad), y
puede cerrar una sesión, todas las de un usuario o todas las del negocio.

- list_business_sessions(): sesiones (auth.sessions) de los usuarios del
  negocio del admin (nunca de administradores de la plataforma).
- revoke_business_session(p_session): cierra una sesión.
- revoke_business_sessions(p_user): cierra todas las sesiones de un usuario
  (p_user) o de todo el negocio (NULL); la sesión actual del admin se conserva.
- session_alive(): la app lo consulta cada minuto y al volver a la pestaña;
  si su sesión fue cerrada, sale al login sin esperar a que venza el token.

Borrar la fila de auth.sessions elimina sus refresh tokens (ON DELETE CASCADE),
así que esa sesión ya no puede renovarse.
*/

CREATE OR REPLACE FUNCTION public.current_session_id()
RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(auth.jwt() ->> 'session_id', '')::uuid $$;

-- Negocio del que el usuario actual es administrador (o error).
CREATE OR REPLACE FUNCTION public.sessions_admin_business()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me profiles%ROWTYPE;
BEGIN
  SELECT * INTO me FROM profiles WHERE id = auth.uid();
  IF me.business_id IS NULL OR (me.business_role <> 'admin' AND me.role <> 'platform_admin') THEN
    RAISE EXCEPTION 'Solo un administrador del negocio puede gestionar las sesiones';
  END IF;
  RETURN me.business_id;
END $$;

CREATE OR REPLACE FUNCTION public.list_business_sessions()
RETURNS TABLE (
  id uuid, user_id uuid, full_name text, username text, email text, business_role text,
  user_agent text, ip text, created_at timestamptz, last_active_at timestamptz, is_current boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE biz uuid := public.sessions_admin_business();
BEGIN
  RETURN QUERY
  SELECT s.id, p.id, p.full_name, p.username, p.email, p.business_role,
         COALESCE(s.user_agent, ''), COALESCE(host(s.ip), ''),
         s.created_at,
         GREATEST(s.created_at, s.updated_at, s.refreshed_at AT TIME ZONE 'UTC'),
         s.id = public.current_session_id()
    FROM auth.sessions s
    JOIN public.profiles p ON p.id = s.user_id
   WHERE p.business_id = biz
     AND p.role <> 'platform_admin'
     AND (s.not_after IS NULL OR s.not_after > now())
   ORDER BY 10 DESC;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_business_session(p_session uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE biz uuid := public.sessions_admin_business(); n integer;
BEGIN
  DELETE FROM auth.sessions s USING public.profiles p
   WHERE s.id = p_session AND p.id = s.user_id
     AND p.business_id = biz AND p.role <> 'platform_admin';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'Sesión no encontrada'; END IF;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_business_sessions(p_user uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE biz uuid := public.sessions_admin_business(); n integer;
BEGIN
  DELETE FROM auth.sessions s USING public.profiles p
   WHERE p.id = s.user_id
     AND p.business_id = biz AND p.role <> 'platform_admin'
     AND (p_user IS NULL OR s.user_id = p_user)
     AND s.id IS DISTINCT FROM public.current_session_id();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.session_alive()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT public.current_session_id() IS NULL
      OR EXISTS (SELECT 1 FROM auth.sessions WHERE id = public.current_session_id())
$$;

REVOKE ALL ON FUNCTION public.sessions_admin_business() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_business_sessions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_business_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_business_sessions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.session_alive() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_business_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_business_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_business_sessions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_alive() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_session_id() TO authenticated;

NOTIFY pgrst, 'reload schema';
