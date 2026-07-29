# White label — plan para implementar más adelante

Objetivo: que cada negocio pueda usar Zetenta bajo su propio dominio y con su
propia marca (logo, colores, nombre), sin desplegar copias de la app. La
arquitectura ya es multi-tenant (RLS por `business_id`), así que solo cambia
la "piel" según el dominio por el que se entra.

## Idea central

Al cargar la app se resuelve `window.location.hostname` → negocio → branding.
Eso pinta login y shell con la marca del negocio **antes** de autenticarse.
El tenant real de los datos se sigue determinando por el usuario logueado
(igual que hoy); el dominio solo decide la apariencia.

## Fase 1 — Branding + subdominios (`eltornillo.zetenta.app`)

1. **Migración**:
   - `businesses.slug text UNIQUE` (subdominio), `businesses.custom_domain text UNIQUE`,
     `businesses.branding jsonb` (`{ "name": "...", "logo_url": "...", "accent": "#0071e3" }`).
   - Función SQL pública `get_branding(p_host text)` (SECURITY DEFINER, ejecutable
     por `anon`) que matchee `slug` (subdominio) o `custom_domain` y devuelva SOLO
     los campos de marca — nunca datos fiscales.
   - Bucket de Storage `branding` (público de lectura) para logos.
2. **Frontend**:
   - Al arrancar (antes del router): `get_branding(hostname)`. Si hay match,
     aplicar `--accent` y demás variables CSS, logo y nombre en Login/Shell,
     `document.title` y favicon. Sin match → marca Zetenta por defecto.
   - Validar en el login que el usuario pertenezca al tenant del dominio
     (perfil.business_id === tenant del hostname); si no, cerrar sesión con aviso.
3. **Admin** (página Administración): campos slug / dominio / branding por negocio.
   El white label queda como algo que activa el administrador de la plataforma.
4. **Netlify**: poner el dominio raíz en Netlify DNS y agregar `*.zetenta.app`
   (wildcard) como domain alias del sitio. SSL automático. Nada que hacer por
   cliente nuevo.
5. **Supabase Auth**: agregar `https://*.zetenta.app/**` a las Redirect URLs.

## Fase 2 — Dominio propio del cliente (`sistema.eltornillo.com`)

Sin código nuevo, solo configuración por cliente:

1. El cliente crea un CNAME `sistema.eltornillo.com → <sitio>.netlify.app`.
2. En Netlify: Site settings → Domain management → agregar el dominio como
   **domain alias** (certificado automático). Límite ~100 aliases por sitio.
   Con volumen, automatizar vía API de Netlify desde el panel de admin.
3. En Supabase Auth: agregar el dominio a las Redirect URLs (uno a uno).
4. En Admin: guardar `custom_domain` en el negocio.

## Letras pequeñas conocidas

- Los correos de Supabase (confirmación / recuperación) salen con una sola
  plantilla y remitente para toda la plataforma; personalizarlos por tenant
  requiere SMTP propio + plantillas dinámicas. Dejarlo para cuando un cliente
  lo exija.
- El comprobante impreso ya usa la razón social del negocio (no dice Zetenta):
  ahí no hay trabajo.
- `public/_redirects` (SPA fallback) ya está en el repo — prerrequisito hecho.
