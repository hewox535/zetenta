/*
# Cashea: inicial por defecto

Cashea es un método de pago especial: en el POS se muestra solo como
"Cashea" y, al elegirlo, la inicial ya viene puesta. El estándar de Cashea
es 40%; cada negocio puede cambiarlo en Negocio → Ventas y la vendedora
puede ajustarlo en cada venta.
*/

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS cashea_initial_percent numeric(5,2) NOT NULL DEFAULT 40;

CREATE OR REPLACE FUNCTION public.set_cashea_initial_percent(p_percent numeric)
RETURNS businesses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
BEGIN
  IF NOT public.is_business_admin() THEN
    RAISE EXCEPTION 'Solo un administrador del negocio puede cambiar los ajustes';
  END IF;
  IF p_percent IS NULL OR p_percent <= 0 OR p_percent >= 100 THEN
    RAISE EXCEPTION 'La inicial debe estar entre 1%% y 99%%';
  END IF;
  UPDATE businesses SET cashea_initial_percent = round(p_percent, 2)
   WHERE id = public.current_business_id()
   RETURNING * INTO b;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  RETURN b;
END $$;
GRANT EXECUTE ON FUNCTION public.set_cashea_initial_percent(numeric) TO authenticated;
