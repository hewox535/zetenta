// API: crea una retención a partir de la imagen de una factura y responde
// con el PDF del comprobante.
//
//   POST /functions/v1/create-withholding
//   Authorization: Bearer <access_token del usuario>   (+ header apikey)
//   Body JSON: {
//     image: string (base64, sin prefijo data:),
//     mimeType?: string (por defecto image/jpeg),
//     issue_date?: "YYYY-MM-DD" (por defecto hoy),
//     retention_rate?: 75 | 100 (por defecto 75)
//   }
//
//   200 → application/pdf (headers x-withholding-id / x-withholding-number)
//   4xx/5xx → JSON { error, extracted? }
//
// La numeración es atómica (RPC create_withholding) y RLS aplica con el
// token del usuario: cada quien solo puede emitir en su propio negocio.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { extractInvoiceImage } from '../_shared/gemini.ts';
import { renderWithholdingPdf } from './pdf.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Expose-Headers': 'x-withholding-id, x-withholding-number',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

const normalizeRif = (r: string) => String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Formato oficial del Nº de control: 00-000000
function controlFormat(value: string) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits ? `00-${digits.slice(-6).padStart(6, '0')}` : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Usa POST.' }, 405);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    );

    // ---- Usuario y negocio ----
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: 'Token inválido: se necesita el access_token de un usuario.' }, 401);
    }
    const { data: profile } = await supabase
      .from('profiles').select('business_id').eq('id', userData.user.id).single();
    if (!profile?.business_id) {
      return json({ error: 'El usuario no tiene un negocio asociado.' }, 403);
    }
    const { data: business } = await supabase
      .from('businesses').select('*').eq('id', profile.business_id).single();
    if (!business) return json({ error: 'Negocio no encontrado.' }, 403);

    // ---- Entrada ----
    const body = await req.json().catch(() => null);
    if (!body?.image) return json({ error: 'Falta "image" (base64).' }, 400);
    const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(body.issue_date || '')
      ? body.issue_date
      : new Date().toISOString().slice(0, 10);
    const retentionRate = body.retention_rate === 100 ? 100 : 75;

    // ---- Extracción ----
    const x = await extractInvoiceImage(body.image, body.mimeType || 'image/jpeg');
    if (!(Number(x.total_with_vat) > 0)) {
      return json({ error: 'No se pudo leer el monto total de la factura.', extracted: x }, 422);
    }
    if (!x.supplier_rif || !x.supplier_name) {
      return json({ error: 'No se pudo identificar al proveedor (nombre y RIF) en la factura.', extracted: x }, 422);
    }

    // ---- Proveedor: buscar por RIF o crear ----
    const rif = normalizeRif(x.supplier_rif);
    const { data: suppliers, error: supErr } = await supabase.from('suppliers').select('*');
    if (supErr) return json({ error: supErr.message }, 500);
    let supplier = (suppliers ?? []).find((s) => normalizeRif(s.rif) === rif);
    if (!supplier) {
      const { data: created, error: createErr } = await supabase.from('suppliers')
        .insert({ business_id: business.id, name: x.supplier_name, rif: x.supplier_rif.toUpperCase() })
        .select().single();
      if (createErr) return json({ error: `No se pudo crear el proveedor: ${createErr.message}` }, 500);
      supplier = created;
    }

    // ---- Crear la retención (numeración atómica en la RPC) ----
    const line = {
      operation_date: /^\d{4}-\d{2}-\d{2}$/.test(x.invoice_date || '') ? x.invoice_date : issueDate,
      invoice_number: x.invoice_number || '',
      control_number: controlFormat(x.control_number || x.invoice_number),
      debit_note: '',
      credit_note: '',
      transaction_type: '01-Reg.',
      affected_document: '',
      total_with_vat: Number(x.total_with_vat),
      exempt_amount: Number(x.exempt_amount) > 0 ? Number(x.exempt_amount) : 0,
      vat_rate: [8, 16, 31].includes(Math.round(Number(x.vat_rate))) ? Math.round(Number(x.vat_rate)) : 16,
      retention_rate: retentionRate,
    };
    const { data: w, error: rpcErr } = await supabase.rpc('create_withholding', {
      p_supplier_id: supplier.id,
      p_issue_date: issueDate,
      p_lines: [line],
    });
    if (rpcErr) return json({ error: rpcErr.message }, 500);

    // ---- PDF ----
    const pdf = await renderWithholdingPdf({
      business,
      number: w.number,
      issue_date: w.issue_date,
      fiscal_period: w.fiscal_period,
      supplier_name: supplier.name,
      supplier_rif: supplier.rif,
      lines: [line],
    });

    const seq = String(Number(w.number.slice(-8)));
    const date = issueDate.split('-').reverse().join('-');
    const filename = `${seq} ${supplier.name} ${date}.pdf`.replace(/[^\w .,-]/g, '');
    return new Response(pdf, {
      headers: {
        ...CORS,
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'x-withholding-id': w.id,
        'x-withholding-number': w.number,
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
