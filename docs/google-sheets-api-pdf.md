# Exportar comprobantes a PDF vía la API de Google Sheets (idea futura)

> Nota guardada el 18/07/2026. La app actual **no** usa nada de esto: imprime una
> réplica exacta del sheet en HTML/CSS (`src/components/ComprobantePrint.jsx`),
> offline y con un clic. Este documento describe cómo sería generar el PDF con
> las APIs de Google si algún día hace falta (p. ej. archivar automáticamente
> cada comprobante en Drive, o generar PDFs en lote).

## El flujo

1. **Duplicar la plantilla**
   - API de Drive: `files.copy` sobre el spreadsheet original
     (`1Ygj_D9Otl-NKYCa_53OB7TLGBS5jg67Z3petEsTL9F0`) crea una copia con todo el
     formato.
   - Alternativa: API de Sheets `sheets.copyTo` para copiar solo una pestaña a
     otro spreadsheet.

2. **Escribir los valores**
   - API de Sheets: `spreadsheets.values.update` (o `batchUpdate` para varias
     celdas/rangos de una vez) con fecha, número, proveedor, montos, etc.
   - El formato (bordes, colores, merges) se conserva porque viene de la copia.

3. **Obtener el PDF** — dos caminos:
   - **`files.export` (API de Drive)** con `mimeType: application/pdf`.
     Devuelve los *bytes* del PDF, no un enlace. Usa la configuración de
     exportación por defecto: no permite controlar orientación ni escala.
     Límite de 10 MB.
   - **URL de export** (no documentada oficialmente pero estable desde hace
     años; es la que usa el botón "Descargar PDF" de Sheets):

     ```
     https://docs.google.com/spreadsheets/d/{ID}/export
       ?format=pdf
       &portrait=false      # horizontal
       &fitw=true           # ajustar al ancho de página
       &gid=0               # pestaña a exportar
       &top_margin=0.5&bottom_margin=0.5&left_margin=0.4&right_margin=0.4  # pulgadas
       &gridlines=false
     ```

     Con el token OAuth en el header `Authorization: Bearer ...` funciona sobre
     sheets privados. Sobre un sheet compartido públicamente funciona sin token
     (así se descargó la plantilla de este proyecto).

   - **No existe un "enlace permanente al PDF"**: o descargas los bytes y los
     guardas donde quieras (p. ej. subirlos a Drive con `files.create` y
     compartir ese archivo), o haces público el sheet y usas la URL de export
     como enlace directo.

## Advertencias

- **Autenticación**: hace falta OAuth (el usuario inicia sesión con Google) o
  una cuenta de servicio. Las credenciales **no pueden ir en la app React del
  navegador** — cualquiera podría extraerlas. Haría falta un pequeño backend.
- **Alternativa sin backend propio**: un **Google Apps Script** publicado como
  web app. El script vive en la cuenta de Google, hace copiar → llenar →
  exportar → guardar en una carpeta de Drive, y expone un endpoint HTTP al que
  la app le manda los datos del comprobante. Cero servidores, cero credenciales
  en el cliente.
- **Requiere internet y cuenta de Google**; la impresión local actual no.

## Cuándo valdría la pena

- Archivar automáticamente cada comprobante en Drive (sheet + PDF).
- Generar PDFs en lote (p. ej. todos los comprobantes de un período).
- Compartir enlaces de Drive con el contador en vez de enviar archivos.

Si es solo imprimir/guardar el PDF del momento, la app ya lo hace idéntico al
original sin depender de Google.
