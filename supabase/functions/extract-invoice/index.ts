// Extrae los datos de una foto de factura venezolana usando Gemini.
//
// Secretos (npx supabase secrets set ...):
//   GEMINI_API_KEY  — clave de https://aistudio.google.com (obligatoria)
//   GEMINI_MODEL    — opcional, por defecto "gemini-flash-latest"
//
// El gateway de Supabase ya exige un JWT válido (verify_jwt), así que solo
// usuarios autenticados de la plataforma pueden invocarla.

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-flash-latest';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Prompt y esquema desacoplados de la llamada: cambiar de proveedor de IA
// solo requiere reescribir callGemini().
const PROMPT = `Analiza esta imagen de una factura venezolana y extrae sus datos.
- supplier_name: razón social o nombre del comercio que EMITE la factura.
- supplier_rif: RIF del emisor (formato tipo J-12345678-9) tal como aparece.
- invoice_number: número de la factura.
- control_number: número de control (suele aparecer como "N° de Control", formato 00-000000).
- invoice_date: fecha de emisión en formato YYYY-MM-DD.
- total_with_vat: monto TOTAL a pagar con IVA incluido, número decimal con punto (ej: 1234.56).
- exempt_amount: monto exento si aparece desglosado; si no, 0.
- vat_rate: alícuota de IVA en porcentaje (normalmente 16; puede ser 8 o 31); si no se distingue, 16.
Si un campo no es legible o no aparece, devuelve cadena vacía (o 0 en los numéricos). No inventes datos.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    supplier_name: { type: 'STRING' },
    supplier_rif: { type: 'STRING' },
    invoice_number: { type: 'STRING' },
    control_number: { type: 'STRING' },
    invoice_date: { type: 'STRING' },
    total_with_vat: { type: 'NUMBER' },
    exempt_amount: { type: 'NUMBER' },
    vat_rate: { type: 'NUMBER' },
  },
  required: [
    'supplier_name', 'supplier_rif', 'invoice_number', 'control_number',
    'invoice_date', 'total_with_vat', 'exempt_amount', 'vat_rate',
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

async function callGemini(imageBase64: string, mimeType: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY! },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
            { text: PROMPT },
          ],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      }),
    },
  );
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`El modelo respondió ${res.status}: ${detail}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
  if (!text) throw new Error('El modelo no devolvió contenido.');
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY no está configurada en el servidor.' }, 500);
    const { image, mimeType } = await req.json();
    if (!image) return json({ error: 'Falta la imagen.' }, 400);
    const extracted = await callGemini(image, mimeType || 'image/jpeg');
    return json({ model: MODEL, extracted });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
