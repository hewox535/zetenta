/*
# Roma: categorías de tienda de ropa

Siembra en la taxonomía Categoría de Roma los mismos términos que usa la
cuenta demo Robert Clothes: Camisas, Pantalones, Vestidos, Chaquetas,
Zapatos y Accesorios. Idempotente (ON CONFLICT DO NOTHING). Data operativa;
va como migración por ser el único canal de ejecución en el remoto.
*/

DO $$
DECLARE
  bid uuid;
  tid uuid;
BEGIN
  SELECT id INTO bid FROM businesses WHERE slug = 'roma';
  IF bid IS NULL THEN
    RAISE NOTICE 'No existe el negocio roma; nada que hacer.';
    RETURN;
  END IF;

  SELECT id INTO tid FROM taxonomies
   WHERE business_id = bid AND name = 'Categoría' AND kind = 'category';
  IF tid IS NULL THEN
    INSERT INTO taxonomies (business_id, name, kind)
    VALUES (bid, 'Categoría', 'category') RETURNING id INTO tid;
  END IF;

  INSERT INTO taxonomy_terms (taxonomy_id, name)
  SELECT tid, v FROM unnest(ARRAY['Camisas','Pantalones','Vestidos','Chaquetas','Zapatos','Accesorios']) v
  ON CONFLICT (taxonomy_id, name) DO NOTHING;

  RAISE NOTICE 'Categorías de ropa sembradas para Roma.';
END $$;
