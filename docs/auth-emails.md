# Correos de autenticación — configuración

El flujo de recuperación de contraseña ya está en la app
(`/forgot-password` → correo → `/reset-password`). Falta una configuración
única en el dashboard de Supabase (el CLI no tiene permisos para esto):

## 1. URLs de redirección (obligatorio para que funcione)

Dashboard → **Authentication → URL Configuration**:

- **Site URL**: la URL de producción en Netlify (ej. `https://zetenta.netlify.app`).
- **Redirect URLs**, agregar:
  - `https://<tu-sitio-netlify>/**`
  - `http://localhost:5173/**` (para desarrollo)

Sin esto, el enlace del correo no puede llevar a `/reset-password` y Supabase
lo manda al Site URL por defecto.

## 2. Plantillas de correo

Dashboard → **Authentication → Emails (Templates)**. Pegar el HTML de
`supabase/templates/` en la plantilla correspondiente:

| Plantilla del dashboard | Archivo | Subject sugerido |
|---|---|---|
| **Reset password** | `templates/recovery.html` | `Restablece tu contraseña de Zetenta` |
| **Confirm signup** | `templates/confirmation.html` | `Confirma tu correo — Zetenta` |

Las plantillas usan la variable `{{ .ConfirmationURL }}` de Supabase; no hay
que editar nada más.

## Cómo funciona el flujo

1. Login → "¿Olvidaste tu contraseña?" → `/forgot-password`.
2. El usuario escribe su correo; se envía el enlace con
   `resetPasswordForEmail(..., redirectTo: <origen>/reset-password)`.
   La respuesta es la misma exista o no la cuenta (no revela correos).
3. El enlace (válido 1 hora, un solo uso) abre `/reset-password` con una
   sesión temporal; el usuario fija la contraseña nueva y entra directo.

## Notas

- El remitente por defecto es el SMTP compartido de Supabase (límites bajos,
  ~2-4 correos/hora). Para producción seria, configurar SMTP propio en
  Authentication → Emails → SMTP Settings (Resend, Postmark, etc.).
- Recuperación manual de emergencia: Dashboard → Authentication → Users →
  (usuario) → ⋯ → "Send password recovery", o "Update user" para fijar una
  contraseña directamente.
