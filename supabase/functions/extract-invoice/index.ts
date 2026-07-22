// Extrae los datos de una foto de factura para pre-rellenar el formulario.
// La lógica de extracción vive en _shared/gemini.ts (compartida con la API
// create-withholding). El gateway de Supabase ya exige un JWT válido.

import { extractInvoiceImage, MODEL } from '../_shared/gemini.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { image, mimeType } = await req.json();
    if (!image) return json({ error: 'Falta la imagen.' }, 400);
    const extracted = await extractInvoiceImage(image, mimeType || 'image/jpeg');
    return json({ model: MODEL, extracted });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
