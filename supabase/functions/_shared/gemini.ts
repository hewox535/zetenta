// Extracción de datos de facturas venezolanas con Gemini.
// Compartido por extract-invoice (formulario) y create-withholding (API).
//
// Secretos: GEMINI_API_KEY (obligatoria), GEMINI_MODEL y
// GEMINI_FALLBACK_MODELS (opcionales; la segunda, separada por comas).

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
export const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-flash-latest';

// Cuando un modelo se satura, esperar y reintentar en el MISMO modelo casi
// nunca sirve: la saturación es de ese modelo, no de la API. Lo que sí sirve es
// cambiarse a otro, que tiene su propia capacidad. Se prueban en orden y se usa
// el primero que conteste.
const FALLBACKS = (Deno.env.get('GEMINI_FALLBACK_MODELS') ?? 'gemini-flash-lite-latest')
  .split(',').map((m) => m.trim()).filter(Boolean);
const MODELS = [MODEL, ...FALLBACKS.filter((m) => m !== MODEL)];

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

// 503/429/500 son fallas transitorias de Gemini (sobrecarga). Se da un
// reintento corto por modelo —por si fue un pico de un segundo— y enseguida se
// pasa al siguiente, que es lo que de verdad destraba. Un modelo que se queda
// colgado tampoco puede dejar al cajero esperando: de ahí el tope por intento.
const RETRYABLE = new Set([429, 500, 503]);
// 404 = ese modelo ya no existe (los alias "latest" se jubilan). No se
// reintenta, pero tampoco se tumba la función: se pasa al siguiente.
const RETRY_DELAY_MS = 700;
const ATTEMPTS_PER_MODEL = 2;
const TIMEOUT_MS = 25000;

async function callModel(model: string, imageBase64: string, mimeType: string): Promise<Response> {
  return await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY! },
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
}

export async function extractInvoiceImage(imageBase64: string, mimeType: string): Promise<ExtractedInvoice> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no está configurada en el servidor.');
  let saturado = false;
  let noDisponible = false;
  let ultimoError: string | null = null;

  for (const model of MODELS) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt++) {
      let res: Response;
      try {
        res = await callModel(model, imageBase64, mimeType);
      } catch (e) {
        // Timeout o fallo de red: cuenta como transitorio, se sigue probando.
        saturado = true;
        ultimoError = `${model}: ${(e as Error).name}`;
        continue;
      }
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p.text ?? '').join('');
        if (!text) throw new Error('El modelo no devolvió contenido.');
        if (model !== MODEL) console.log(`Factura leída con el modelo de respaldo ${model}.`);
        return JSON.parse(text);
      }
      if (RETRYABLE.has(res.status)) {
        await res.body?.cancel();
        saturado = true;
        ultimoError = `${model}: ${res.status}`;
        if (attempt + 1 < ATTEMPTS_PER_MODEL) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      if (res.status === 404) {
        await res.body?.cancel();
        noDisponible = true;
        ultimoError = `${model}: 404`;
        break;
      }
      // Un error que no es de sobrecarga (imagen inválida, clave mala…) no
      // mejora cambiando de modelo: se informa tal cual.
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`El modelo respondió ${res.status}: ${detail}`);
    }
  }

  console.error(`Ningún modelo pudo leer la factura. Último: ${ultimoError}`);
  if (saturado) {
    throw new Error('El servicio de lectura de facturas está saturado en este momento. Intenta de nuevo en unos segundos.');
  }
  if (noDisponible) {
    throw new Error('El modelo de lectura de facturas no está disponible. Revisa GEMINI_MODEL en el servidor.');
  }
  throw new Error('No se pudo leer la factura.');
}
