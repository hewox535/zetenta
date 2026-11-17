/*
# Precio de venta por margen sobre el costo

apply_price_markup(p_percent, p_scope, p_round): pone el precio de venta de
golpe a partir del costo: precio = costo × (1 + p_percent/100).

- p_scope: 'missing' (solo productos sin precio, el caso de un inventario
  recién cargado con costos) o 'all' (recalcula todos los que tienen costo).
- p_round: 'none' (2 decimales), 'int' (sube al dólar entero) o '99'
  (termina en ,99 sin quedar por debajo del cálculo).
- Productos sin costo se saltan y se cuentan en la respuesta.
- Variantes con costo propio reciben su propio precio con el mismo margen;
  las que heredan el costo del producto siguen heredando el precio.

Permiso: el mismo que cambiar precios a mano (has_inventory_perm
'inv_edit_price'). Devuelve { products, variants, skipped }.
*/

CREATE OR REPLACE FUNCTION public.price_with_markup(p_cost numeric, p_percent numeric, p_round text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_round
    WHEN 'int' THEN ceil(round(p_cost * (1 + p_percent / 100), 2))
    WHEN '99'  THEN ceil(round(p_cost * (1 + p_percent / 100), 2) + 0.01) - 0.01
    ELSE round(p_cost * (1 + p_percent / 100), 2)
  END
$$;

CREATE OR REPLACE FUNCTION public.apply_price_markup(
  p_percent numeric, p_scope text DEFAULT 'missing', p_round text DEFAULT 'none'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid := public.current_business_id();
  n_prod int := 0;
  n_var int := 0;
  n_skip int := 0;
BEGIN
  IF b_id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  IF NOT public.has_inventory_perm('inv_edit_price') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar precios';
  END IF;
  IF p_percent IS NULL OR p_percent < 0 OR p_percent > 1000 THEN
    RAISE EXCEPTION 'El margen debe estar entre 0 y 1000 %%';
  END IF;
  IF p_scope NOT IN ('missing', 'all') THEN RAISE EXCEPTION 'Alcance inválido'; END IF;
  IF p_round NOT IN ('none', 'int', '99') THEN RAISE EXCEPTION 'Redondeo inválido'; END IF;

  SELECT count(*) INTO n_skip FROM products
   WHERE business_id = b_id AND COALESCE(cost, 0) <= 0
     AND (p_scope = 'all' OR COALESCE(price, 0) = 0);

  UPDATE products
     SET price = public.price_with_markup(cost, p_percent, p_round)
   WHERE business_id = b_id AND cost > 0
     AND (p_scope = 'all' OR COALESCE(price, 0) = 0);
  GET DIAGNOSTICS n_prod = ROW_COUNT;

  UPDATE product_variants
     SET price = public.price_with_markup(cost, p_percent, p_round)
   WHERE business_id = b_id AND cost > 0
     AND (p_scope = 'all' OR COALESCE(price, 0) = 0);
  GET DIAGNOSTICS n_var = ROW_COUNT;

  RETURN jsonb_build_object('products', n_prod, 'variants', n_var, 'skipped', n_skip);
END $$;

GRANT EXECUTE ON FUNCTION public.apply_price_markup(numeric, text, text) TO authenticated;
