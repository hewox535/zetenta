# White label por dominio

Cada negocio puede usar la plataforma bajo su propia marca (nombre, logo, color)
según el dominio por el que se entra, sin desplegar copias de la app. La
arquitectura es multi-tenant (RLS por `business_id`); el dominio solo decide la
**apariencia**. El tenant real de los datos lo sigue determinando el usuario
logueado.

**Estado: Fase 1 implementada.** Fase 2 (dominio propio) es solo configuración.

## Cómo funciona

Al arrancar, antes del router, `BrandingProvider` resuelve
`window.location.hostname` → marca del negocio y la aplica:

- Recolorea el acento (`--accent` y derivados `--accent-soft/-ring/-line` vía
  `color-mix`), pinta el nombre/logo en Login, Shell y Splash.
- SEO dinámico de identidad: `document.title`, `favicon`, `theme-color`,
  `description` y Open Graph (`og:title/og:description/og:site_name`) reflejan el
  negocio del dominio. Sin match → marca Zetenta por defecto.

## Implementación (ya en el repo)

**Base de datos** (`migrations/20260729150000_white_label.sql`):
- `businesses.slug` (subdominio), `businesses.custom_domain` (dominio propio,
  ambos con índice único parcial que ignora NULL) y `businesses.branding` jsonb
  (`{ name, logo_url, accent }`).
- `get_branding(p_host)` — `SECURITY DEFINER`, ejecutable por `anon`. Devuelve
  **solo** campos de marca (`business_id, name, logo_url, accent`), nunca datos
  fiscales. Coincide por `custom_domain` exacto o por el primer segmento del host
  contra el `slug` (`robert-clothes.hewox.com` → slug `robert-clothes`).

**Frontend**:
- `src/context/BrandingContext.jsx` — provider que resuelve el host y aplica
  marca + SEO. `src/components/Brand.jsx` — logo o wordmark según la marca.
- El azul del sistema se tokenizó (`--accent-soft/-ring/-line` en `index.css`)
  para que el recoloreado sea coherente en toda la UI.

**Admin** (página Administración): botón **"Marca"** por negocio → modal para
configurar `slug`, `custom_domain`, `name`, `accent` (color) y `logo_url`.
Solo el administrador de la plataforma puede hacerlo (RLS de `businesses`
permite UPDATE únicamente a `platform_admin`).

## Qué configurar por cada dominio nuevo (infra, no código)

Ejemplo con `robert-clothes.hewox.com`:

1. **Desplegar** el frontend a Netlify (las migraciones ya están en la BD).
2. **DNS** del dominio base (`hewox.com`): `CNAME robert-clothes → <sitio>.netlify.app`.
   Para muchos clientes, un wildcard `CNAME *.hewox.com → <sitio>.netlify.app`
   (requiere Netlify DNS para el comodín).
3. **Netlify** → Site settings → Domain management → agregar
   `robert-clothes.hewox.com` (o `*.hewox.com`) como **domain alias**. SSL
   automático. Límite ~100 aliases por sitio; con volumen, automatizar vía API.
4. **Supabase** → Authentication → URL Configuration → **Redirect URLs**:
   agregar `https://robert-clothes.hewox.com/**` (o `https://*.hewox.com/**`).
   Necesario para que login y correos de recuperación/confirmación redirijan al
   dominio correcto.
5. **En la plataforma** (Administración → Marca): fijar el `slug` del negocio.

Con eso, entrar al dominio pinta la marca del negocio antes de autenticar. El
dominio raíz (`hewox.com`) y cualquiera sin match muestran la marca Zetenta.

## Fase 2 — Dominio propio del cliente (`tienda.robertclothes.com`)

Sin código nuevo: el cliente crea un CNAME hacia el sitio de Netlify, se agrega
como domain alias en Netlify y a las Redirect URLs de Supabase, y el admin
guarda `custom_domain` en el negocio.

## Letras pequeñas conocidas

- El logo se referencia por URL (`branding.logo_url`). Para servir logos propios,
  crear un bucket de Storage `branding` (lectura pública) y subir ahí; aún no
  está creado.
- La validación "el usuario pertenece al tenant del dominio" no se fuerza: los
  datos ya están aislados por RLS según el usuario logueado, así que el dominio
  es puramente cosmético. Si se quisiera, `get_branding` ya devuelve el
  `business_id` para comparar contra `profile.business_id`.
- Los correos de Supabase salen con una sola plantilla/remitente para toda la
  plataforma; personalizarlos por tenant requiere SMTP propio.
- `public/_redirects` (SPA fallback) ya está en el repo.
