/*
# Cancelar una venta, con PIN del dueño

Una venta hecha por error se cancela desde el historial: el stock vuelve al
inventario y la venta queda marcada como cancelada (no se borra, para que el
historial siga cuadrando).

- orders.cancelled_at / cancelled_by / cancel_reason: quién la canceló,
  cuándo y por qué.
- La devolución del stock entra como movimientos 'in' con la nota
  "Cancelación de la venta Nº …", así que el historial de inventario también
  deja constancia.
- Las ventas canceladas no cuentan en Estadísticas (lo filtra la app).

El PIN lo pone el admin del negocio y NO se guarda en claro: va cifrado con
bcrypt en business_secrets, una tabla sin política de lectura (ni el admin la
puede leer por la API; solo las funciones SECURITY DEFINER de aquí abajo la
tocan). Así un PIN no se filtra aunque alguien lea la fila del negocio.

- set_cancel_pin(pin): solo el admin del negocio; 4 a 8 dígitos.
- has_cancel_pin(): si el negocio ya tiene PIN, para que la app lo diga.
- cancel_order(id, pin, motivo): valida el PIN y hace todo lo anterior.
*/

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_orders_cancelled ON orders (business_id, cancelled_at);

-- ---------- Secreto por negocio: el PIN, cifrado ----------
CREATE TABLE IF NOT EXISTS business_secrets (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  cancel_pin_hash text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE business_secrets ENABLE ROW LEVEL SECURITY;
-- Sin políticas: nadie la lee ni la escribe por la API. Solo las funciones
-- SECURITY DEFINER de abajo (y el service role) entran aquí.

-- ---------- Poner o cambiar el PIN (solo el admin del negocio) ----------
CREATE OR REPLACE FUNCTION public.set_cancel_pin(p_pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
BEGIN
  IF NOT public.is_business_admin() THEN
    RAISE EXCEPTION 'Solo un administrador del negocio puede cambiar el PIN';
  END IF;
  b_id := public.current_business_id();
  IF b_id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;

  IF p_pin IS NULL OR btrim(p_pin) = '' THEN
    -- PIN vacío: se quita y deja de poder cancelarse hasta poner otro.
    INSERT INTO business_secrets (business_id, cancel_pin_hash, updated_at)
    VALUES (b_id, NULL, now())
    ON CONFLICT (business_id) DO UPDATE SET cancel_pin_hash = NULL, updated_at = now();
    RETURN;
  END IF;

  IF btrim(p_pin) !~ '^[0-9]{4,8}$' THEN
    RAISE EXCEPTION 'El PIN debe tener entre 4 y 8 dígitos';
  END IF;

  INSERT INTO business_secrets (business_id, cancel_pin_hash, updated_at)
  VALUES (b_id, extensions.crypt(btrim(p_pin), extensions.gen_salt('bf')), now())
  ON CONFLICT (business_id) DO UPDATE
    SET cancel_pin_hash = EXCLUDED.cancel_pin_hash, updated_at = now();
END $$;

-- ---------- ¿El negocio ya tiene PIN? ----------
CREATE OR REPLACE FUNCTION public.has_cancel_pin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_secrets
     WHERE business_id = public.current_business_id() AND cancel_pin_hash IS NOT NULL
  )
$$;

-- ---------- Cancelar la venta ----------
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_pin text, p_reason text DEFAULT '')
RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
  o orders%ROWTYPE;
  hash text;
  it record;
BEGIN
  b_id := public.current_business_id();
  IF b_id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;

  SELECT * INTO o FROM orders WHERE id = p_order_id AND business_id = b_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF o.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Esa venta ya está cancelada'; END IF;

  SELECT cancel_pin_hash INTO hash FROM business_secrets WHERE business_id = b_id;
  IF hash IS NULL THEN
    RAISE EXCEPTION 'Este negocio aún no tiene PIN de cancelación; configúralo en Negocio → Ventas';
  END IF;
  IF p_pin IS NULL OR extensions.crypt(btrim(p_pin), hash) <> hash THEN
    RAISE EXCEPTION 'PIN incorrecto';
  END IF;

  -- El stock vuelve: una entrada por cada línea, a la sucursal de la venta.
  FOR it IN SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = o.id LOOP
    IF it.variant_id IS NOT NULL AND it.quantity > 0 THEN
      INSERT INTO inventory_movements (business_id, product_id, variant_id, branch_id, type, quantity, note, created_by, order_id)
      VALUES (b_id, it.product_id, it.variant_id, o.branch_id, 'in', it.quantity,
              'Cancelación de la venta Nº ' || o.number, auth.uid(), o.id);
    END IF;
  END LOOP;

  UPDATE orders
     SET cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = COALESCE(btrim(p_reason), '')
   WHERE id = o.id
   RETURNING * INTO o;
  RETURN o;
END $$;

GRANT EXECUTE ON FUNCTION public.set_cancel_pin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_cancel_pin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text, text) TO authenticated;
