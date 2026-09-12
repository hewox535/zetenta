// Extracción de datos de facturas venezolanas con Gemini.
// Compartido por extract-invoice (formulario) y create-withholding (API).
//
// Secretos: GEMINI_API_KEY (obligatoria), GEMINI_MODEL (opcional).

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
export const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-flash-latest';

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

export interface ExtractedInvoice {
  supplier_name: string;
  supplier_rif: string;
  invoice_number: string;
  control_number: string;
  invoice_date: string;
  total_with_vat: number;
  exempt_amount: number;
  vat_rate: number;
}

// 503/429/500 son fallas transitorias de Gemini (sobrecarga): se reintenta con
// espera creciente antes de rendirse.
const RETRYABLE = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [1000, 2500, 5000];

export async function extractInvoiceImage(imageBase64: string, mimeType: string): Promise<ExtractedInvoice> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no está configurada en el servidor.');
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
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
    if (res.ok) break;
    if (RETRYABLE.has(res.status) && attempt < RETRY_DELAYS_MS.length) {
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      continue;
    }
    if (RETRYABLE.has(res.status)) {
      throw new Error('El servicio de lectura de facturas está saturado en este momento. Intenta de nuevo en unos segundos.');
    }
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`El modelo respondió ${res.status}: ${detail}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
  if (!text) throw new Error('El modelo no devolvió contenido.');
  return JSON.parse(text);
}
