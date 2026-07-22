# API de retenciones

Endpoint para crear una retención enviando la imagen de la factura y recibir
el PDF del comprobante en la misma llamada.

```
POST {SUPABASE_URL}/functions/v1/create-withholding
```

## Autenticación

Se autentica como un usuario de la plataforma (el negocio del usuario define
dónde se emite la retención; RLS aplica igual que en la app):

```
Authorization: Bearer {access_token del usuario}
apikey: {anon key del proyecto}
```

Para integraciones máquina-a-máquina, obtén el `access_token` con el
grant de contraseña de Supabase Auth:

```bash
curl -s "{SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: {ANON_KEY}" -H "Content-Type: application/json" \
  -d '{"email":"usuario@negocio.com","password":"..."}'
# → { "access_token": "...", ... }  (expira en ~1h; refresca con refresh_token)
```

## Petición

Body JSON:

| Campo | Tipo | Descripción |
|---|---|---|
| `image` | string | **Obligatorio.** La factura en base64 (sin prefijo `data:`). JPEG/PNG/WebP. Ideal ≤ ~1600px por lado. |
| `mimeType` | string | Opcional, por defecto `image/jpeg`. |
| `issue_date` | string | Opcional, `YYYY-MM-DD`. Fecha de emisión del comprobante; por defecto hoy. |
| `retention_rate` | number | Opcional, `75` (defecto) o `100`. |

## Qué hace

1. Extrae de la imagen (Gemini, salida estructurada): proveedor, RIF, números
   de factura y control, fecha, total, exento y alícuota.
2. Busca el proveedor por RIF en el negocio; si no existe **lo crea**.
3. Emite la retención con numeración correlativa atómica (la misma secuencia
   que la app).
4. Genera y devuelve el PDF del comprobante en formato oficial.

## Respuestas

- **200** — `application/pdf` (el comprobante). Headers útiles:
  - `x-withholding-id`: UUID de la retención creada.
  - `x-withholding-number`: número completo (`202607` + correlativo de 8 dígitos).
  - `content-disposition`: nombre sugerido `{correlativo} {proveedor} {fecha}.pdf`.
- **401** — token ausente/ inválido (se necesita access_token de usuario, no el anon key solo).
- **403** — el usuario no tiene negocio asociado.
- **422** — la imagen no permitió extraer total o proveedor. El body incluye
  `extracted` con lo que sí se leyó, para diagnóstico. **No se creó nada.**
- **5xx** — error del modelo o de base de datos (body JSON con `error`).

## Ejemplo completo

```bash
SUPABASE_URL="https://<proyecto>.supabase.co"
ANON_KEY="<anon key>"

TOKEN=$(curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"usuario@negocio.com","password":"..."}' | jq -r .access_token)

IMG=$(base64 -i factura.jpg | tr -d '\n')

curl -s "$SUPABASE_URL/functions/v1/create-withholding" \
  -H "Authorization: Bearer $TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"image\":\"$IMG\"}" \
  -o comprobante.pdf -D headers.txt

grep -i x-withholding headers.txt
```

## Notas

- Cada llamada exitosa **consume un número del correlativo** del negocio. Un
  reintento tras un 200 crearía un duplicado con otro número — trata el 200
  como definitivo.
- Los 422 no crean nada: son seguros de reintentar con mejor foto.
- La retención creada aparece de inmediato en la app (Retenciones), donde
  también se puede reimprimir.
- El modelo de IA es configurable con el secreto `GEMINI_MODEL` sin tocar código.
