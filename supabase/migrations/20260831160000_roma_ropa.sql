/*
# Cuenta Roma → tienda de ropa

Roma (slug 'roma') se creó con la plantilla 'general' (Marca/Modelo, vacías).
Se convierte a la plantilla de ropa: business_type = 'ropa', se eliminan las
taxonomías vacías Marca/Modelo y se siembran Categoría + Talla (S–XXL) +
Color (comunes), igual que seed_default_taxonomies para 'ropa'.

Idempotente: solo actúa si Roma existe y aún no tiene esas taxonomías. Data
operativa; va como migración por ser el único canal de ejecución en el remoto.
*/

DO $$
DECLARE
  bid uuid;
  t_talla uuid;
  t_color uuid;
BEGIN
  SELECT id INTO bid FROM businesses WHERE slug = 'roma';
  IF bid IS NULL THEN
    RAISE NOTICE 'No existe el negocio roma; nada que hacer.';
    RETURN;
  END IF;

  UPDATE businesses SET business_type = 'ropa' WHERE id = bid;

  -- Marca/Modelo de la plantilla general: fuera solo si están vacías (sin términos).
  DELETE FROM taxonomies t
  WHERE t.business_id = bid AND t.name IN ('Marca', 'Modelo') AND t.kind = 'category'
    AND NOT EXISTS (SELECT 1 FROM taxonomy_terms tt WHERE tt.taxonomy_id = t.id);

  IF NOT EXISTS (SELECT 1 FROM taxonomies WHERE business_id = bid AND name = 'Categoría') THEN
    INSERT INTO taxonomies (business_id, name, kind) VALUES (bid, 'Categoría', 'category');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM taxonomies WHERE business_id = bid AND name = 'Talla' AND kind = 'variant') THEN
    INSERT INTO taxonomies (business_id, name, kind) VALUES (bid, 'Talla', 'variant') RETURNING id INTO t_talla;
    INSERT INTO taxonomy_terms (taxonomy_id, name)
      SELECT t_talla, v FROM unnest(ARRAY['S','M','L','XL','XXL']) v;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM taxonomies WHERE business_id = bid AND name = 'Color' AND kind = 'variant') THEN
    INSERT INTO taxonomies (business_id, name, kind) VALUES (bid, 'Color', 'variant') RETURNING id INTO t_color;
    INSERT INTO taxonomy_terms (taxonomy_id, name)
      SELECT t_color, v FROM unnest(ARRAY['Negro','Blanco','Azul','Rojo','Gris','Beige','Rosa','Verde']) v;
  END IF;

  RAISE NOTICE 'Roma configurada como tienda de ropa.';
END $$;
