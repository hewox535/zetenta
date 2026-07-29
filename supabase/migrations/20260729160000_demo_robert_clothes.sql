/*
# Cuenta demo: Robert Clothes (tienda de ropa)

Crea una cuenta lista para enseñar al cliente:
- Usuario auth robert-clothes@hewox.com (confirmado) + identidad email.
- El trigger handle_new_user crea el negocio, el perfil y los métodos de pago.
- Branding + slug "robert-clothes" (→ robert-clothes.hewox.com).
- Categorías (Categoría, Talla, Color) e inventario de ropa con stock.

Idempotente: si el usuario ya existe, no hace nada. Es data de demostración; se
mantiene como migración porque es el único canal de ejecución en el remoto.
*/

DO $$
DECLARE
  uid uuid := gen_random_uuid();
  bid uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = 'robert-clothes@hewox.com') THEN
    RAISE NOTICE 'La cuenta demo ya existe; se omite.';
    RETURN;
  END IF;

  -- Usuario de autenticación (contraseña: clothes123), correo ya confirmado
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change,
    email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    'robert-clothes@hewox.com', extensions.crypt('clothes123', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}',
    '{"business_name":"Robert Clothes","full_name":"Robert Clothes"}',
    now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), uid::text, uid,
    jsonb_build_object('sub', uid::text, 'email', 'robert-clothes@hewox.com', 'email_verified', true),
    'email', now(), now(), now()
  );

  -- El trigger ya creó el negocio; lo ubicamos por el perfil
  SELECT business_id INTO bid FROM profiles WHERE id = uid;
  IF bid IS NULL THEN RAISE EXCEPTION 'No se creó el negocio demo'; END IF;

  -- Branding + dominio + datos fiscales de ejemplo
  UPDATE businesses SET
    rif = 'J-501234567',
    fiscal_address = 'Av. Principal, Local 12, Caracas',
    slug = 'robert-clothes',
    branding = '{"name":"Robert Clothes","accent":"#4f46e5"}'::jsonb
  WHERE id = bid;

  -- Taxonomías
  INSERT INTO taxonomies (business_id, name) VALUES (bid, 'Categoría'), (bid, 'Talla'), (bid, 'Color');

  INSERT INTO taxonomy_terms (taxonomy_id, name)
  SELECT t.id, v.name FROM taxonomies t
  JOIN (VALUES ('Camisas'),('Pantalones'),('Vestidos'),('Chaquetas'),('Zapatos'),('Accesorios')) AS v(name) ON true
  WHERE t.business_id = bid AND t.name = 'Categoría';

  INSERT INTO taxonomy_terms (taxonomy_id, name)
  SELECT t.id, v.name FROM taxonomies t
  JOIN (VALUES ('S'),('M'),('L'),('XL')) AS v(name) ON true
  WHERE t.business_id = bid AND t.name = 'Talla';

  INSERT INTO taxonomy_terms (taxonomy_id, name)
  SELECT t.id, v.name FROM taxonomies t
  JOIN (VALUES ('Negro'),('Blanco'),('Azul'),('Beige'),('Marrón')) AS v(name) ON true
  WHERE t.business_id = bid AND t.name = 'Color';

  -- Productos (precios en dólares)
  INSERT INTO products (business_id, name, sku, unit, price, stock) VALUES
    (bid, 'Camisa Oxford Azul',   'CAM-OXF-AZ', 'und', 24.99, 40),
    (bid, 'Camisa Lino Blanca',   'CAM-LIN-BL', 'und', 29.50, 25),
    (bid, 'Pantalón Chino Beige', 'PAN-CHI-BE', 'und', 34.00, 30),
    (bid, 'Jean Slim Negro',      'PAN-JEA-NE', 'und', 39.99, 35),
    (bid, 'Vestido Floral',       'VES-FLO-BL', 'und', 45.00, 18),
    (bid, 'Vestido Casual Negro', 'VES-CAS-NE', 'und', 42.50, 20),
    (bid, 'Chaqueta Denim',       'CHA-DEN-AZ', 'und', 59.99, 15),
    (bid, 'Zapatos Cuero Marrón', 'ZAP-CUE-MA', 'par', 69.90, 12),
    (bid, 'Zapatillas Blancas',   'ZAP-DEP-BL', 'par', 54.99, 22),
    (bid, 'Correa de Cuero',      'ACC-COR-NE', 'und', 19.99, 50);

  -- Clasificación: cada producto → (Categoría, Talla, Color)
  INSERT INTO product_terms (product_id, term_id)
  SELECT p.id, tt.id
  FROM products p
  JOIN (VALUES
    ('Camisa Oxford Azul',   'Categoría','Camisas'),   ('Camisa Oxford Azul',   'Talla','M'), ('Camisa Oxford Azul',   'Color','Azul'),
    ('Camisa Lino Blanca',   'Categoría','Camisas'),   ('Camisa Lino Blanca',   'Talla','L'), ('Camisa Lino Blanca',   'Color','Blanco'),
    ('Pantalón Chino Beige', 'Categoría','Pantalones'),('Pantalón Chino Beige', 'Talla','M'), ('Pantalón Chino Beige', 'Color','Beige'),
    ('Jean Slim Negro',      'Categoría','Pantalones'),('Jean Slim Negro',      'Talla','L'), ('Jean Slim Negro',      'Color','Negro'),
    ('Vestido Floral',       'Categoría','Vestidos'),  ('Vestido Floral',       'Talla','S'), ('Vestido Floral',       'Color','Blanco'),
    ('Vestido Casual Negro', 'Categoría','Vestidos'),  ('Vestido Casual Negro', 'Talla','M'), ('Vestido Casual Negro', 'Color','Negro'),
    ('Chaqueta Denim',       'Categoría','Chaquetas'), ('Chaqueta Denim',       'Talla','L'), ('Chaqueta Denim',       'Color','Azul'),
    ('Zapatos Cuero Marrón', 'Categoría','Zapatos'),   ('Zapatos Cuero Marrón', 'Talla','XL'),('Zapatos Cuero Marrón', 'Color','Marrón'),
    ('Zapatillas Blancas',   'Categoría','Zapatos'),   ('Zapatillas Blancas',   'Talla','XL'),('Zapatillas Blancas',   'Color','Blanco'),
    ('Correa de Cuero',      'Categoría','Accesorios'),('Correa de Cuero',      'Talla','M'), ('Correa de Cuero',      'Color','Negro')
  ) AS m(pname, taxname, termname) ON p.name = m.pname
  JOIN taxonomies tx ON tx.business_id = bid AND tx.name = m.taxname
  JOIN taxonomy_terms tt ON tt.taxonomy_id = tx.id AND tt.name = m.termname
  WHERE p.business_id = bid;

  RAISE NOTICE 'Cuenta demo Robert Clothes creada (negocio %).', bid;
END $$;
