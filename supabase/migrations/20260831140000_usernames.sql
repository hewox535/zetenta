/*
# Nombres de usuario: login sin correo y personal sin correo obligatorio

- profiles.username: identificador único opcional (minúsculas, 3–30 chars,
  letras/números/._-). El personal creado sin correo recibe un correo auth
  sintético (usuario@staff.zetenta.app) que nunca se muestra en la UI;
  profiles.email guarda solo correos reales ('' si no hay).
- login_email(username): resuelve el username al correo auth para poder usar
  signInWithPassword. SECURITY DEFINER ejecutable por anon (el login ocurre
  antes de tener sesión). Devuelve NULL si no existe.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username text
  CHECK (username IS NULL OR username ~ '^[a-z0-9._-]{3,30}$');

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key
  ON profiles (lower(username)) WHERE username IS NOT NULL;

CREATE OR REPLACE FUNCTION public.login_email(p_username text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.email
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(p.username) = lower(trim(p_username))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.login_email(text) TO anon, authenticated;
