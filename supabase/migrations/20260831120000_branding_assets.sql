/*
# Marca: segundo color, favicon y bucket de Storage para activos de marca

- branding gana dos claves nuevas en el jsonb (sin cambio de esquema):
  · accent2: color secundario (estados hover / énfasis secundario).
  · favicon_url: ícono en buena calidad; se usa como favicon del tab y como
    ícono al agregar la app a la pantalla de inicio.
- get_branding(host) devuelve ahora también favicon_url y accent2. Cambia el
  tipo de retorno, por lo que hay que DROP + CREATE (no basta OR REPLACE).
- Bucket público 'branding' en Supabase Storage para logos y favicons subidos
  desde el panel admin: lectura pública, escritura solo platform_admin.
*/

DROP FUNCTION IF EXISTS public.get_branding(text);
CREATE FUNCTION public.get_branding(p_host text)
RETURNS TABLE (business_id uuid, name text, logo_url text, favicon_url text, accent text, accent2 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id,
         COALESCE(NULLIF(b.branding->>'name', ''), b.name),
         b.branding->>'logo_url',
         b.branding->>'favicon_url',
         COALESCE(NULLIF(b.branding->>'accent', ''), ''),
         COALESCE(NULLIF(b.branding->>'accent2', ''), '')
  FROM businesses b
  WHERE b.custom_domain = lower(p_host)
     OR (b.slug IS NOT NULL AND b.slug = split_part(lower(p_host), '.', 1))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_branding(text) TO anon, authenticated;

-- ---------- Bucket de activos de marca ----------
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

-- Lectura pública; escritura/borrado solo del administrador de la plataforma.
DROP POLICY IF EXISTS "branding read" ON storage.objects;
CREATE POLICY "branding read" ON storage.objects FOR SELECT
  USING (bucket_id = 'branding');

DROP POLICY IF EXISTS "branding insert" ON storage.objects;
CREATE POLICY "branding insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'branding' AND public.is_platform_admin());

DROP POLICY IF EXISTS "branding update" ON storage.objects;
CREATE POLICY "branding update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'branding' AND public.is_platform_admin());

DROP POLICY IF EXISTS "branding delete" ON storage.objects;
CREATE POLICY "branding delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'branding' AND public.is_platform_admin());
