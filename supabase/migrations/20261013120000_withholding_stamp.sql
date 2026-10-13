/*
# Sello del negocio en el comprobante de retención

Algunos comprobantes se entregan sellados y otros no, así que el sello no
puede ser parte fija del formato: cada comprobante decide si lo lleva.

- businesses.stamp_url: la imagen del sello del negocio, una sola por negocio.
  La sube el administrador en Negocio → Retenciones; conviene que sea un PNG
  con el fondo transparente, para que se vea como un sello puesto sobre el
  papel y no como un recuadro blanco encima.
- withholdings.stamped: si ESE comprobante se imprime con el sello. Arranca en
  false, así que nada de lo ya emitido cambia de aspecto.

Marcar o quitar el sello va por su propia función y no por update_withholding:
es una decisión de presentación, no del contenido fiscal, y así ponerle el
sello a un comprobante viejo no reescribe sus líneas ni toca el correlativo.

El sello va en un bucket aparte de 'branding', porque 'branding' lo escribe
solo el administrador de la plataforma y este lo sube el propio negocio.
*/

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stamp_url text NOT NULL DEFAULT '';
ALTER TABLE withholdings ADD COLUMN IF NOT EXISTS stamped boolean NOT NULL DEFAULT false;

-- ---------- Guardar (o quitar) el sello del negocio ----------
CREATE OR REPLACE FUNCTION public.set_stamp_url(p_url text)
RETURNS businesses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
BEGIN
  IF NOT public.is_business_admin() THEN
    RAISE EXCEPTION 'Solo un administrador del negocio puede cambiar el sello';
  END IF;
  UPDATE businesses SET stamp_url = COALESCE(btrim(p_url), '')
   WHERE id = public.current_business_id()
   RETURNING * INTO b;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  RETURN b;
END $$;

-- ---------- ¿Este comprobante lleva sello? ----------
CREATE OR REPLACE FUNCTION public.set_withholding_stamped(p_id uuid, p_stamped boolean)
RETURNS withholdings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w withholdings%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM businesses
     WHERE id = public.current_business_id()
       AND COALESCE((capabilities->>'retentions')::boolean, false)
  ) THEN
    RAISE EXCEPTION 'Retentions capability is disabled for this business';
  END IF;
  UPDATE withholdings SET stamped = COALESCE(p_stamped, false)
   WHERE id = p_id AND business_id = public.current_business_id()
   RETURNING * INTO w;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Comprobante no encontrado'; END IF;
  RETURN w;
END $$;

-- ---------- Bucket del sello ----------
INSERT INTO storage.buckets (id, name, public)
VALUES ('stamps', 'stamps', true)
ON CONFLICT (id) DO NOTHING;

-- Lectura pública (el comprobante se imprime y se comparte); escribir y borrar,
-- solo el administrador del negocio y solo dentro de la carpeta de su negocio.
DROP POLICY IF EXISTS "stamps read" ON storage.objects;
CREATE POLICY "stamps read" ON storage.objects FOR SELECT
  USING (bucket_id = 'stamps');

DROP POLICY IF EXISTS "stamps insert" ON storage.objects;
CREATE POLICY "stamps insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'stamps' AND public.is_business_admin()
    AND (storage.foldername(name))[1] = public.current_business_id()::text);

DROP POLICY IF EXISTS "stamps update" ON storage.objects;
CREATE POLICY "stamps update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'stamps' AND public.is_business_admin()
    AND (storage.foldername(name))[1] = public.current_business_id()::text);

DROP POLICY IF EXISTS "stamps delete" ON storage.objects;
CREATE POLICY "stamps delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'stamps' AND public.is_business_admin()
    AND (storage.foldername(name))[1] = public.current_business_id()::text);

GRANT EXECUTE ON FUNCTION public.set_stamp_url(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_withholding_stamped(uuid, boolean) TO authenticated;
