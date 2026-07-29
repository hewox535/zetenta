/*
# Limpieza de la demo: quitar taxonomías por defecto irrelevantes

Todo negocio nace con "Marca" y "Modelo" (pensadas para autopartes). En la
tienda de ropa demo sobran; se eliminan solo si están vacías (sin términos),
para no borrar nada que se haya usado.
*/

DELETE FROM taxonomies t
USING businesses b
WHERE t.business_id = b.id
  AND b.slug = 'robert-clothes'
  AND t.name IN ('Marca', 'Modelo')
  AND NOT EXISTS (SELECT 1 FROM taxonomy_terms tt WHERE tt.taxonomy_id = t.id);
