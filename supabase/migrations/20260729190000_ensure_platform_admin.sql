/*
# Asegura y reporta el usuario administrador de la plataforma

- Si ya existe algún perfil con role = 'platform_admin', lo reporta (NOTICE) y no
  crea ninguno.
- Si no existe ninguno, crea admin@hewox.com (contraseña: admin12345) como
  administrador de la plataforma: usuario auth confirmado, SIN negocio asociado
  y con role = 'platform_admin'.

Idempotente. Es data operativa; se mantiene como migración por ser el único
canal de ejecución en el remoto.
*/

DO $$
DECLARE
  r record;
  cnt int := 0;
  uid uuid;
BEGIN
  FOR r IN SELECT email FROM profiles WHERE role = 'platform_admin' LOOP
    cnt := cnt + 1;
    RAISE NOTICE 'Administrador existente: %', r.email;
  END LOOP;

  IF cnt > 0 THEN
    RAISE NOTICE 'Ya hay % administrador(es); no se crea ninguno.', cnt;
    RETURN;
  END IF;

  uid := gen_random_uuid();

  -- Usuario admin SIN business_name → el trigger crea perfil sin negocio
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change,
    email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    'admin@hewox.com', extensions.crypt('admin12345', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}',
    '{"full_name":"Administrador de la plataforma"}',
    now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), uid::text, uid,
    jsonb_build_object('sub', uid::text, 'email', 'admin@hewox.com', 'email_verified', true),
    'email', now(), now(), now()
  );

  UPDATE profiles SET role = 'platform_admin' WHERE id = uid;

  RAISE NOTICE 'Administrador creado: admin@hewox.com / admin12345';
END $$;
