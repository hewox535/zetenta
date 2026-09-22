/*
# Permisos detallados del inventario

Hasta ahora profiles.permissions.inventory daba a la vendedora el módulo
completo. Ahora "inventory" solo le da acceso (ver), y cada acción se activa
por separado:

- inv_edit_info   editar nombre, SKU, nota y categorías/propiedades
- inv_edit_media  subir y quitar imágenes
- inv_edit_price  cambiar precio, costo y ofertas
- inv_edit_stock  cambiar cantidades: entradas, salidas, ajustes, traslados,
                  stock objetivo
- inv_create      crear productos (incluye sus datos iniciales), importar CSV
                  y agregar variaciones
- inv_delete      eliminar productos y variaciones

El admin del negocio (y el admin de plataforma) tiene todo sin necesitarlos.
Las vendedoras que ya tenían inventory = true reciben todos los permisos
nuevos para no perder lo que podían hacer.

Se aplica en el servidor, no solo en la UI:
- has_inventory_perm(key): helper para RLS, triggers y RPC.
- Triggers BEFORE UPDATE en products y product_variants que revisan qué
  columnas cambian. Solo actúan con pg_trigger_depth() = 1 (la sentencia del
  cliente o del RPC que llamó); los recálculos de stock que hace
  apply_inventory_movement al vender (profundidad 2) no se ven afectados.
- Triggers BEFORE INSERT en products y product_variants: exigen inv_create
  (cubre create_product_with_variants y add_product_variant, SECURITY DEFINER).
- RLS: borrar productos/variantes (inv_delete), movimientos directos
  (inv_edit_stock), imágenes y su Storage (inv_edit_media o inv_create, para
  subir las fotos del producto recién creado), product_terms (inv_edit_info o
  inv_create).
- update_product_details: sin inv_edit_info no toca las categorías.
- transfer_stock: exige inv_edit_stock.
- set_staff_permissions acepta las claves nuevas.
*/

-- ---------- Helper ----------
CREATE OR REPLACE FUNCTION public.has_inventory_perm(p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
     WHERE id = auth.uid()
       AND (role = 'platform_admin'
            OR (business_id IS NOT NULL AND business_role = 'admin')
            OR (business_id IS NOT NULL
                AND COALESCE((permissions->>'inventory')::boolean, false)
                AND COALESCE((permissions->>p_key)::boolean, false)))
  )
$$;

GRANT EXECUTE ON FUNCTION public.has_inventory_perm(text) TO authenticated;

-- ---------- Migración de permisos existentes ----------
UPDATE profiles
   SET permissions = permissions || jsonb_build_object(
     'inv_edit_info', true, 'inv_edit_media', true, 'inv_edit_price', true,
     'inv_edit_stock', true, 'inv_create', true, 'inv_delete', true)
 WHERE COALESCE((permissions->>'inventory')::boolean, false);

-- ---------- set_staff_permissions: claves nuevas ----------
CREATE OR REPLACE FUNCTION public.set_staff_permissions(p_user uuid, p_permissions jsonb)
RETURNS profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me profiles%ROWTYPE;
  target profiles%ROWTYPE;
  k text;
BEGIN
  SELECT * INTO me FROM profiles WHERE id = auth.uid();
  IF me.business_id IS NULL OR me.business_role <> 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador del negocio puede cambiar permisos';
  END IF;
  FOR k IN SELECT jsonb_object_keys(COALESCE(p_permissions, '{}'::jsonb)) LOOP
    IF k NOT IN ('inventory', 'stats', 'retentions',
                 'inv_edit_info', 'inv_edit_media', 'inv_edit_price',
                 'inv_edit_stock', 'inv_create', 'inv_delete') THEN
      RAISE EXCEPTION 'Permiso desconocido: %', k;
    END IF;
  END LOOP;
  SELECT * INTO target FROM profiles WHERE id = p_user AND business_id = me.business_id;
  IF target.id IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado en tu negocio'; END IF;
  IF target.role = 'platform_admin' THEN RAISE EXCEPTION 'No permitido'; END IF;
  UPDATE profiles SET permissions = COALESCE(p_permissions, '{}'::jsonb)
   WHERE id = p_user RETURNING * INTO target;
  RETURN target;
END $$;

-- ---------- Guardas por columna al editar ----------
CREATE OR REPLACE FUNCTION public.guard_product_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Recálculos anidados (stock tras una venta o movimiento) y service role.
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF (NEW.name, NEW.sku, NEW.unit, NEW.note, NEW.variant_axes)
     IS DISTINCT FROM (OLD.name, OLD.sku, OLD.unit, OLD.note, OLD.variant_axes)
     AND NOT public.has_inventory_perm('inv_edit_info') THEN
    RAISE EXCEPTION 'No tienes permiso para editar los datos del producto';
  END IF;
  IF (NEW.price, NEW.cost, NEW.offer_percent) IS DISTINCT FROM (OLD.price, OLD.cost, OLD.offer_percent)
     AND NOT public.has_inventory_perm('inv_edit_price') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar precios, costos u ofertas';
  END IF;
  IF NEW.stock IS DISTINCT FROM OLD.stock
     AND NOT public.has_inventory_perm('inv_edit_stock') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar cantidades';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_product_update ON products;
CREATE TRIGGER guard_product_update BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION public.guard_product_update();

CREATE OR REPLACE FUNCTION public.guard_variant_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF (NEW.sku, NEW.attributes) IS DISTINCT FROM (OLD.sku, OLD.attributes)
     AND NOT public.has_inventory_perm('inv_edit_info') THEN
    RAISE EXCEPTION 'No tienes permiso para editar los datos del producto';
  END IF;
  IF (NEW.price, NEW.cost) IS DISTINCT FROM (OLD.price, OLD.cost)
     AND NOT public.has_inventory_perm('inv_edit_price') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar precios o costos';
  END IF;
  IF (NEW.stock, NEW.target_stock) IS DISTINCT FROM (OLD.stock, OLD.target_stock)
     AND NOT public.has_inventory_perm('inv_edit_stock') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar cantidades';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_variant_update ON product_variants;
CREATE TRIGGER guard_variant_update BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION public.guard_variant_update();

-- ---------- Crear productos / variaciones ----------
CREATE OR REPLACE FUNCTION public.guard_product_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT public.has_inventory_perm('inv_create') THEN
    RAISE EXCEPTION 'No tienes permiso para crear productos';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_product_insert ON products;
CREATE TRIGGER guard_product_insert BEFORE INSERT ON products
  FOR EACH ROW EXECUTE FUNCTION public.guard_product_insert();
DROP TRIGGER IF EXISTS guard_variant_insert ON product_variants;
CREATE TRIGGER guard_variant_insert BEFORE INSERT ON product_variants
  FOR EACH ROW EXECUTE FUNCTION public.guard_product_insert();

-- ---------- RLS: borrar, movimientos directos, imágenes, términos ----------
DROP POLICY IF EXISTS products_delete ON products;
CREATE POLICY products_delete ON products FOR DELETE TO authenticated
  USING (business_id = public.current_business_id() AND public.has_inventory_perm('inv_delete'));

DROP POLICY IF EXISTS variants_delete ON product_variants;
CREATE POLICY variants_delete ON product_variants FOR DELETE TO authenticated
  USING (business_id = public.current_business_id() AND public.has_inventory_perm('inv_delete'));

DROP POLICY IF EXISTS movements_insert ON inventory_movements;
CREATE POLICY movements_insert ON inventory_movements FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.current_business_id()
    AND public.has_inventory_perm('inv_edit_stock')
    AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.business_id = public.current_business_id())
  );

DROP POLICY IF EXISTS product_media_insert ON product_media;
CREATE POLICY product_media_insert ON product_media FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id()
    AND (public.has_inventory_perm('inv_edit_media') OR public.has_inventory_perm('inv_create'))
    AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.business_id = public.current_business_id()));
DROP POLICY IF EXISTS product_media_update ON product_media;
CREATE POLICY product_media_update ON product_media FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id() AND public.has_inventory_perm('inv_edit_media'))
  WITH CHECK (business_id = public.current_business_id());
DROP POLICY IF EXISTS product_media_delete ON product_media;
CREATE POLICY product_media_delete ON product_media FOR DELETE TO authenticated
  USING (business_id = public.current_business_id() AND public.has_inventory_perm('inv_edit_media'));

DROP POLICY IF EXISTS "product-media insert" ON storage.objects;
CREATE POLICY "product-media insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-media'
    AND (storage.foldername(name))[1] = public.current_business_id()::text
    AND (public.has_inventory_perm('inv_edit_media') OR public.has_inventory_perm('inv_create')));
DROP POLICY IF EXISTS "product-media update" ON storage.objects;
CREATE POLICY "product-media update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-media' AND (storage.foldername(name))[1] = public.current_business_id()::text
    AND public.has_inventory_perm('inv_edit_media'));
DROP POLICY IF EXISTS "product-media delete" ON storage.objects;
CREATE POLICY "product-media delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-media' AND (storage.foldername(name))[1] = public.current_business_id()::text
    AND public.has_inventory_perm('inv_edit_media'));

DROP POLICY IF EXISTS product_terms_insert ON product_terms;
CREATE POLICY product_terms_insert ON product_terms FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_inventory_perm('inv_edit_info') OR public.has_inventory_perm('inv_create'))
    AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.business_id = public.current_business_id())
    AND EXISTS (
      SELECT 1 FROM taxonomy_terms tt JOIN taxonomies t ON t.id = tt.taxonomy_id
      WHERE tt.id = term_id AND t.business_id = public.current_business_id()
    )
  );
DROP POLICY IF EXISTS product_terms_delete ON product_terms;
CREATE POLICY product_terms_delete ON product_terms FOR DELETE TO authenticated
  USING (public.has_inventory_perm('inv_edit_info')
    AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.business_id = public.current_business_id()));

-- ---------- update_product_details: categorías solo con inv_edit_info ----------
CREATE OR REPLACE FUNCTION public.update_product_details(
  p_id uuid, p_name text, p_sku text, p_unit text, p_price numeric, p_categories jsonb,
  p_cost numeric DEFAULT 0, p_note text DEFAULT ''
) RETURNS products LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_id uuid;
  prod products%ROWTYPE;
  cat record;
  tax_id uuid;
  term_id uuid;
BEGIN
  b_id := public.current_business_id();
  IF b_id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  SELECT * INTO prod FROM products WHERE id = p_id AND business_id = b_id;
  IF prod.id IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;

  -- El trigger guard_product_update revisa los permisos de cada columna.
  UPDATE products SET
    name = btrim(p_name), sku = COALESCE(p_sku, ''),
    unit = COALESCE(NULLIF(btrim(p_unit), ''), 'und'),
    price = COALESCE(p_price, 0), cost = COALESCE(p_cost, 0), note = COALESCE(p_note, '')
   WHERE id = p_id RETURNING * INTO prod;

  IF NOT public.has_inventory_perm('inv_edit_info') THEN RETURN prod; END IF;

  -- Reemplaza categorías Y propiedades: quita todos los enlaces a términos
  -- de taxonomías del negocio (de cualquier kind) y re-inserta lo recibido.
  DELETE FROM product_terms pt
   USING taxonomy_terms tt JOIN taxonomies t ON t.id = tt.taxonomy_id
   WHERE pt.product_id = p_id AND pt.term_id = tt.id
     AND t.business_id = b_id;

  IF p_categories IS NOT NULL THEN
    FOR cat IN SELECT key, value FROM jsonb_each_text(p_categories) LOOP
      IF COALESCE(btrim(cat.value), '') = '' THEN CONTINUE; END IF;
      SELECT id INTO tax_id FROM taxonomies WHERE business_id = b_id AND name = cat.key;
      IF tax_id IS NULL THEN CONTINUE; END IF;
      INSERT INTO taxonomy_terms (taxonomy_id, name) VALUES (tax_id, btrim(cat.value))
        ON CONFLICT (taxonomy_id, name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO term_id;
      INSERT INTO product_terms (product_id, term_id) VALUES (p_id, term_id)
        ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN prod;
END $$;

-- ---------- transfer_stock: exige inv_edit_stock ----------
CREATE OR REPLACE FUNCTION public.transfer_stock(
  p_variant_id uuid, p_from uuid, p_to uuid, p_qty numeric, p_note text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bid uuid := public.current_business_id();
  prod uuid;
BEGIN
  IF NOT public.has_inventory_perm('inv_edit_stock') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar cantidades';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'Origen y destino no pueden ser la misma sucursal'; END IF;
  SELECT product_id INTO prod FROM product_variants WHERE id = p_variant_id AND business_id = bid;
  IF prod IS NULL THEN RAISE EXCEPTION 'Variant not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_from AND business_id = bid) THEN RAISE EXCEPTION 'Origen no válido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_to AND business_id = bid) THEN RAISE EXCEPTION 'Destino no válido'; END IF;

  INSERT INTO inventory_movements (business_id, product_id, variant_id, branch_id, type, quantity, note, created_by)
    VALUES (bid, prod, p_variant_id, p_from, 'out', p_qty, COALESCE(NULLIF(p_note, ''), 'Traslado'), auth.uid());
  INSERT INTO inventory_movements (business_id, product_id, variant_id, branch_id, type, quantity, note, created_by)
    VALUES (bid, prod, p_variant_id, p_to, 'in', p_qty, COALESCE(NULLIF(p_note, ''), 'Traslado'), auth.uid());
END $$;
