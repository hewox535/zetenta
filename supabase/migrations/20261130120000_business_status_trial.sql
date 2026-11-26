/*
# Estado del negocio: solicitud de prueba gratuita, aprobación y desactivación

- businesses.status: 'pending' (se registró y aún no fue aprobado), 'active' o
  'disabled'. Los negocios existentes quedan activos.
- Quien se registra en zetenta.app crea su negocio YA configurado (nombre,
  subdominio y color de marca, desde el formulario), pero en 'pending': entra a
  una pantalla para solicitar la prueba gratuita (request_trial). El admin de
  la plataforma lo aprueba (set_business_status → 'active') y listo.
- La puerta real es current_business_id(): solo resuelve negocios ACTIVOS, así
  que un negocio pendiente o desactivado no puede leer ni escribir nada (todas
  las políticas RLS y RPCs dependen de ella). my_business() le da al usuario el
  estado de su negocio aunque no esté activo.
- get_branding() solo devuelve la marca de negocios activos: el subdominio de
  uno pendiente o desactivado (o uno que no existe) muestra la página genérica
  de "no encontrado".
- Desactivar también bloquea el inicio de sesión de sus usuarios y cierra sus
  sesiones; reactivar lo revierte.
*/

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
DO $$ BEGIN
  ALTER TABLE businesses ADD CONSTRAINT businesses_status_check CHECK (status IN ('pending', 'active', 'disabled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS trial_requested_at timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

-- ---------- La puerta: solo negocios activos ----------
CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.business_id FROM profiles p
    JOIN businesses b ON b.id = p.business_id AND b.status = 'active'
   WHERE p.id = auth.uid()
$$;

-- ---------- Marca por dominio: solo negocios activos ----------
CREATE OR REPLACE FUNCTION public.get_branding(p_host text)
RETURNS TABLE(business_id uuid, name text, logo_url text, favicon_url text, accent text, accent2 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id,
         COALESCE(NULLIF(b.branding->>'name', ''), b.name),
         b.branding->>'logo_url',
         b.branding->>'favicon_url',
         COALESCE(NULLIF(b.branding->>'accent', ''), ''),
         COALESCE(NULLIF(b.branding->>'accent2', ''), '')
  FROM businesses b
  WHERE b.status = 'active'
    AND (b.custom_domain = lower(p_host)
         OR (b.slug IS NOT NULL AND b.slug = split_part(lower(p_host), '.', 1)))
  LIMIT 1;
$$;

-- ---------- Subdominios ----------
-- Reservados: no los puede tomar un negocio.
CREATE OR REPLACE FUNCTION public.slug_reserved(p_slug text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_slug = ANY (ARRAY['www','app','admin','api','staff','l','mail','smtp','panel','zetenta','soporte',
    'help','ayuda','status','blog','cdn','static','assets','login','registro','register','demo','test','dev','staging']);
$$;

-- Normaliza un texto a subdominio: minúsculas, sin acentos, letras/números/guiones.
CREATE OR REPLACE FUNCTION public.business_slug(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT left(trim(both '-' from regexp_replace(
           translate(lower(coalesce(p, '')), 'áéíóúüñàèìòùç', 'aeiouunaeiouc'),
           '[^a-z0-9]+', '-', 'g')), 30);
$$;

-- Para el formulario de registro (sin sesión): ¿está libre este subdominio?
CREATE OR REPLACE FUNCTION public.slug_available(p_slug text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s text := public.business_slug(p_slug);
BEGIN
  IF length(s) < 3 THEN RETURN 'short'; END IF;
  IF public.slug_reserved(s) THEN RETURN 'reserved'; END IF;
  IF EXISTS (SELECT 1 FROM businesses WHERE slug = s) THEN RETURN 'taken'; END IF;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION public.slug_available(text) TO anon, authenticated;

-- ---------- Registro: negocio configurado, en espera de aprobación ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_name text := btrim(COALESCE(meta->>'business_name', ''));
  v_slug text;
  v_accent text := meta->>'accent';
  v_accent2 text := meta->>'accent2';
  n int := 1;
BEGIN
  IF v_name <> '' THEN
    -- Subdominio: el elegido en el formulario; si no sirve (o se lo ganaron), uno
    -- a partir del nombre con un número al final.
    v_slug := public.business_slug(COALESCE(NULLIF(meta->>'slug', ''), v_name));
    IF length(v_slug) < 3 THEN v_slug := v_slug || '-negocio'; END IF;
    WHILE public.slug_reserved(v_slug) OR EXISTS (SELECT 1 FROM businesses WHERE slug = v_slug) LOOP
      n := n + 1;
      v_slug := left(public.business_slug(COALESCE(NULLIF(meta->>'slug', ''), v_name)), 26) || '-' || n;
    END LOOP;
    IF v_accent IS NULL OR v_accent !~ '^#[0-9a-fA-F]{6}$' THEN v_accent := '#2323FF'; END IF;
    IF v_accent2 IS NULL OR v_accent2 !~ '^#[0-9a-fA-F]{6}$' THEN v_accent2 := v_accent; END IF;

    INSERT INTO businesses (name, business_type, status, slug, branding)
    VALUES (v_name, COALESCE(NULLIF(meta->>'business_type', ''), 'general'), 'pending', v_slug,
            jsonb_build_object('name', v_name, 'accent', v_accent, 'accent2', v_accent2))
    RETURNING id INTO b_id;
    INSERT INTO bank_accounts (business_id, name, currency, sort_order) VALUES
      (b_id, 'Pago móvil', 'VES', 0),
      (b_id, 'Dólares', 'USD', 1);
    INSERT INTO branches (business_id, name, is_default, sort_order)
      VALUES (b_id, 'Principal', true, 0);
  END IF;
  INSERT INTO profiles (id, business_id, full_name, email)
  VALUES (NEW.id, b_id, COALESCE(meta->>'full_name', ''), COALESCE(NEW.email, ''));
  RETURN NEW;
END $$;

-- ---------- Para el usuario: su negocio aunque no esté activo ----------
CREATE OR REPLACE FUNCTION public.my_business()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
           'id', b.id, 'name', b.name, 'slug', b.slug, 'status', b.status, 'branding', b.branding,
           'business_type', b.business_type, 'trial_requested_at', b.trial_requested_at,
           'created_at', b.created_at, 'is_admin', p.business_role = 'admin')
    FROM profiles p JOIN businesses b ON b.id = p.business_id
   WHERE p.id = auth.uid()
$$;
GRANT EXECUTE ON FUNCTION public.my_business() TO authenticated;

-- Pide la prueba gratuita (el dueño de un negocio pendiente).
CREATE OR REPLACE FUNCTION public.request_trial()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bid uuid;
BEGIN
  SELECT p.business_id INTO bid FROM profiles p JOIN businesses b ON b.id = p.business_id
   WHERE p.id = auth.uid() AND p.business_role = 'admin' AND b.status = 'pending';
  IF bid IS NULL THEN RAISE EXCEPTION 'No hay una solicitud pendiente para tu negocio'; END IF;
  UPDATE businesses SET trial_requested_at = COALESCE(trial_requested_at, now()) WHERE id = bid;
  RETURN public.my_business();
END $$;
GRANT EXECUTE ON FUNCTION public.request_trial() TO authenticated;

-- Mientras espera la aprobación, el dueño puede ajustar color y logo de su marca.
CREATE OR REPLACE FUNCTION public.set_pending_branding(p_accent text, p_accent2 text, p_logo_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bid uuid;
BEGIN
  SELECT p.business_id INTO bid FROM profiles p JOIN businesses b ON b.id = p.business_id
   WHERE p.id = auth.uid() AND p.business_role = 'admin' AND b.status = 'pending';
  IF bid IS NULL THEN RAISE EXCEPTION 'Tu negocio no está pendiente de aprobación'; END IF;
  IF p_accent IS NOT NULL AND p_accent !~ '^#[0-9a-fA-F]{6}$' THEN RAISE EXCEPTION 'Color no válido'; END IF;
  IF p_logo_url IS NOT NULL AND p_logo_url <> ''
     AND p_logo_url NOT LIKE '%/storage/v1/object/public/branding/' || bid || '/%' THEN
    RAISE EXCEPTION 'Logo no válido';
  END IF;
  UPDATE businesses SET branding = branding
      || CASE WHEN p_accent IS NOT NULL THEN jsonb_build_object('accent', p_accent, 'accent2', COALESCE(p_accent2, p_accent)) ELSE '{}'::jsonb END
      || CASE WHEN p_logo_url IS NOT NULL THEN jsonb_build_object('logo_url', NULLIF(p_logo_url, '')) ELSE '{}'::jsonb END
   WHERE id = bid;
  RETURN public.my_business();
END $$;
GRANT EXECUTE ON FUNCTION public.set_pending_branding(text, text, text) TO authenticated;

-- El dueño puede subir el logo a la carpeta de su negocio (también estando pendiente).
DROP POLICY IF EXISTS "branding insert own" ON storage.objects;
CREATE POLICY "branding insert own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'branding' AND (storage.foldername(name))[1] = (
    SELECT p.business_id::text FROM public.profiles p WHERE p.id = auth.uid() AND p.business_role = 'admin'));

-- ---------- Administración de la plataforma ----------
-- Aprobar / reactivar ('active') o desactivar ('disabled'). Desactivar bloquea el
-- inicio de sesión de todos sus usuarios y cierra sus sesiones.
CREATE OR REPLACE FUNCTION public.set_business_status(p_business uuid, p_status text)
RETURNS businesses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b businesses%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Solo el administrador de la plataforma puede hacer esto'; END IF;
  IF p_status NOT IN ('active', 'disabled') THEN RAISE EXCEPTION 'Estado no válido'; END IF;
  UPDATE businesses SET status = p_status,
         approved_at = CASE WHEN p_status = 'active' THEN COALESCE(approved_at, now()) ELSE approved_at END,
         disabled_at = CASE WHEN p_status = 'disabled' THEN now() ELSE NULL END
   WHERE id = p_business RETURNING * INTO b;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Negocio no encontrado'; END IF;

  IF p_status = 'disabled' THEN
    UPDATE auth.users SET banned_until = now() + interval '100 years'
     WHERE id IN (SELECT id FROM profiles WHERE business_id = p_business);
    DELETE FROM auth.refresh_tokens WHERE user_id IN (SELECT id::text FROM profiles WHERE business_id = p_business);
    DELETE FROM auth.sessions WHERE user_id IN (SELECT id FROM profiles WHERE business_id = p_business);
  ELSE
    UPDATE auth.users SET banned_until = NULL
     WHERE id IN (SELECT id FROM profiles WHERE business_id = p_business);
  END IF;
  RETURN b;
END $$;
GRANT EXECUTE ON FUNCTION public.set_business_status(uuid, text) TO authenticated;

-- Peyi y su demo quedaron desactivadas (sus usuarios ya estaban bloqueados).
UPDATE businesses SET status = 'disabled', disabled_at = now() WHERE slug IN ('peyi', 'peyi-demo');
