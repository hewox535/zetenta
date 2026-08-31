/*
# Propiedades de variación en productos simples

Un producto simple (sin variaciones) puede llevar Talla, Color, etc. como
dato del producto: se guardan como product_terms de taxonomías kind='variant',
igual que las categorías. Los productos CON variaciones siguen llevando esos
valores en product_variants.attributes (no en product_terms).

update_product_details limitaba el reemplazo de términos a kind='category';
se quita esa restricción para que las propiedades del producto simple se
guarden y reemplacen igual que las categorías. create_product_with_variants
ya aceptaba cualquier taxonomía en p_categories (sin filtro de kind).
*/

CREATE OR REPLACE FUNCTION public.update_product_details(
  p_id uuid, p_name text, p_sku text, p_unit text, p_price numeric, p_categories jsonb
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

  UPDATE products SET
    name = btrim(p_name), sku = COALESCE(p_sku, ''),
    unit = COALESCE(NULLIF(btrim(p_unit), ''), 'und'), price = COALESCE(p_price, 0)
   WHERE id = p_id RETURNING * INTO prod;

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
