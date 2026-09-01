/*
# Cliente obligatorio en la venta (configurable por negocio)

- businesses.customer_config: {"required": bool, "fields": {"document": bool,
  "phone": bool}}. required exige elegir/crear cliente para finalizar la
  venta; fields marca qué datos son obligatorios al crear el cliente desde el
  POS (el nombre siempre lo es). Default {} = todo opcional (comportamiento
  actual).
- update_customer_config(): mismo patrón que update_order_settings (miembro
  del negocio; la UI lo expone solo al admin).
- Roma queda con cliente, documento y teléfono obligatorios.
*/

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS customer_config jsonb NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.update_customer_config(p_customer_config jsonb)
RETURNS businesses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b businesses%ROWTYPE;
BEGIN
  UPDATE businesses SET customer_config = COALESCE(p_customer_config, '{}'::jsonb)
   WHERE id = public.current_business_id()
   RETURNING * INTO b;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  RETURN b;
END $$;

GRANT EXECUTE ON FUNCTION public.update_customer_config(jsonb) TO authenticated;

UPDATE businesses
   SET customer_config = '{"required": true, "fields": {"document": true, "phone": true}}'::jsonb
 WHERE slug = 'roma';
