/*
# Caja: modo "cierre del día" (caja siempre abierta)

Dos formas de trabajar la caja, por negocio (businesses.cash_mode):

- 'daily' (nuevo, por defecto para todos): la caja de cada sucursal está
  siempre abierta. No hay que abrirla: si no hay turno abierto, se abre solo
  con la primera venta (trigger) o al ir a hacer el cierre / un retiro
  (ensure_cash_session). Al final del día se hace el "cierre del día" con el
  arqueo de siempre; el turno siguiente se abre solo, con fondo inicial igual a
  lo que se contó en ese cierre (el efectivo que quedó en la caja).
- 'shift': como hasta ahora; se abre la caja declarando el fondo y se cierra.
  Lo vendido con la caja cerrada no entra en ningún arqueo.

Nada cambia en el arqueo ni en el historial: un cierre del día es un cierre de
turno como los de antes.
*/

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS cash_mode text NOT NULL DEFAULT 'daily';
DO $$ BEGIN
  ALTER TABLE businesses ADD CONSTRAINT businesses_cash_mode_check CHECK (cash_mode IN ('daily', 'shift'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Abre (si hace falta) el turno de una sucursal ----------
-- Interna: la usan el trigger de ventas y ensure_cash_session(). El fondo
-- inicial de cada cuenta es lo contado en el último cierre de esa sucursal.
CREATE OR REPLACE FUNCTION public.open_cash_session_auto(p_business uuid, p_branch uuid, p_user uuid)
RETURNS cash_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s cash_sessions%ROWTYPE;
  prev uuid;
  br_name text := '';
BEGIN
  SELECT * INTO s FROM cash_sessions
   WHERE business_id = p_business AND closed_at IS NULL AND branch_id IS NOT DISTINCT FROM p_branch
   LIMIT 1;
  IF s.id IS NOT NULL THEN RETURN s; END IF;

  SELECT id INTO prev FROM cash_sessions
   WHERE business_id = p_business AND closed_at IS NOT NULL AND branch_id IS NOT DISTINCT FROM p_branch
   ORDER BY closed_at DESC LIMIT 1;
  SELECT name INTO br_name FROM branches WHERE id = p_branch;

  BEGIN
    INSERT INTO cash_sessions (business_id, branch_id, branch_name, opened_by, open_note)
    VALUES (p_business, p_branch, COALESCE(br_name, ''), p_user, 'Apertura automática')
    RETURNING * INTO s;
  EXCEPTION WHEN unique_violation THEN
    -- Otra venta simultánea ya la abrió: se usa esa.
    SELECT * INTO s FROM cash_sessions
     WHERE business_id = p_business AND closed_at IS NULL AND branch_id IS NOT DISTINCT FROM p_branch
     LIMIT 1;
    RETURN s;
  END;

  INSERT INTO cash_session_lines (session_id, account_id, account_name, currency, is_cash, sort_order, opening)
  SELECT s.id, a.id, a.name, a.currency, a.is_cash, a.sort_order,
         CASE WHEN a.is_cash THEN COALESCE((
           SELECT l.counted FROM cash_session_lines l WHERE l.session_id = prev AND l.account_id = a.id
         ), 0) ELSE 0 END
    FROM bank_accounts a
   WHERE a.business_id = p_business AND a.active;
  RETURN s;
END $$;
REVOKE EXECUTE ON FUNCTION public.open_cash_session_auto(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------- Para la app: el turno abierto de la sucursal, creándolo si hace falta ----------
CREATE OR REPLACE FUNCTION public.ensure_cash_session(p_branch_id uuid DEFAULT NULL)
RETURNS cash_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
  br uuid;
BEGIN
  IF NOT public.has_cash_perm() THEN RAISE EXCEPTION 'No tienes permiso para la caja'; END IF;
  SELECT * INTO b FROM businesses WHERE id = public.current_business_id();
  IF b.id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  IF b.cash_mode <> 'daily' THEN RAISE EXCEPTION 'La caja de este negocio se abre a mano'; END IF;
  br := COALESCE(p_branch_id, public.default_branch_id(b.id));
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = br AND business_id = b.id) THEN
    RAISE EXCEPTION 'Esa sucursal no es de tu negocio';
  END IF;
  IF NOT public.can_access_branch(br) THEN RAISE EXCEPTION 'No tienes acceso a esta sucursal'; END IF;
  RETURN public.open_cash_session_auto(b.id, br, auth.uid());
END $$;
GRANT EXECUTE ON FUNCTION public.ensure_cash_session(uuid) TO authenticated;

-- ---------- Ventas: en modo diario siempre entran a un turno ----------
CREATE OR REPLACE FUNCTION public.set_order_cash_session()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.cash_session_id IS NULL THEN
    SELECT id INTO NEW.cash_session_id FROM cash_sessions
     WHERE business_id = NEW.business_id
       AND closed_at IS NULL
       AND branch_id IS NOT DISTINCT FROM NEW.branch_id
     LIMIT 1;
    IF NEW.cash_session_id IS NULL
       AND EXISTS (SELECT 1 FROM businesses WHERE id = NEW.business_id AND cash_mode = 'daily') THEN
      NEW.cash_session_id := (public.open_cash_session_auto(NEW.business_id, NEW.branch_id, NEW.created_by)).id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ---------- Configuración (solo administradores) ----------
CREATE OR REPLACE FUNCTION public.set_cash_mode(p_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_business_admin() THEN RAISE EXCEPTION 'Solo un administrador puede cambiar esto'; END IF;
  IF p_mode NOT IN ('daily', 'shift') THEN RAISE EXCEPTION 'Modo de caja no válido'; END IF;
  UPDATE businesses SET cash_mode = p_mode WHERE id = public.current_business_id();
END $$;
GRANT EXECUTE ON FUNCTION public.set_cash_mode(text) TO authenticated;
