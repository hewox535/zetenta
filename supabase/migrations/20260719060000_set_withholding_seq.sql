/*
# Correlativo configurable por negocio

Permite que el negocio ajuste su numeración de comprobantes indicando el
último número ya emitido (p. ej. "van 137" → el siguiente será 138).
withholding_seq guarda siempre el PRÓXIMO número a usar.
*/

CREATE OR REPLACE FUNCTION public.set_withholding_seq(p_last integer)
RETURNS businesses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
BEGIN
  IF p_last IS NULL OR p_last < 0 OR p_last > 99999999 THEN
    RAISE EXCEPTION 'Invalid sequence value';
  END IF;
  UPDATE businesses
     SET withholding_seq = p_last + 1
   WHERE id = public.current_business_id()
   RETURNING * INTO b;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  RETURN b;
END $$;

GRANT EXECUTE ON FUNCTION public.set_withholding_seq(integer) TO authenticated;
