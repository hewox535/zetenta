// Facturación digital: documentos de la solicitud, estados, formatos y el
// Libro de Ventas. Ver docs/facturacion-digital-seniat.md.

export const IVA_RATES = [
  [16, 'General 16 %'],
  [8, 'Reducida 8 %'],
  [0, 'Exento'],
];
export const ivaLabel = (r) => (IVA_RATES.find(([v]) => Number(v) === Number(r)) || IVA_RATES[0])[1];

// Número de factura y de control con el formato de la norma: 8 dígitos y,
// en el de control, "00-" + 8 dígitos (lo asigna la imprenta digital).
export const invoiceNo = (n) => String(n ?? '').padStart(8, '0');
export const DOC_TITLES = { factura: 'Factura', nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito' };

export const STATUS = {
  draft: { label: 'Borrador', tone: 'muted' },
  submitted: { label: 'En revisión', tone: 'warn' },
  active: { label: 'Activa', tone: 'ok' },
  rejected: { label: 'Requiere cambios', tone: 'danger' },
};

export const PERSON_TYPES = [
  ['natural', 'Natural', 'Firma personal, emprendimiento o profesional independiente.'],
  ['juridica', 'Jurídica', 'Compañía anónima, SRL u otra sociedad con acta constitutiva.'],
];
export const TAXPAYER_TYPES = [
  ['ordinario', 'Ordinario', 'La mayoría de los comercios.'],
  ['especial', 'Especial', 'Designado así por el SENIAT (te lo notificaron por escrito).'],
];
export const METHODS = [
  ['ninguno', 'Aún no facturo', 'Será tu primera factura.'],
  ['maquina', 'Máquina fiscal', 'O impresora fiscal homologada.'],
  ['forma_libre', 'Forma libre', 'Talonario de imprenta con números de control.'],
  ['digital', 'Digital', 'Con otra imprenta digital.'],
];

// Documentos de la solicitud. step: en qué paso del asistente se piden.
// accept: tipos de archivo; pdfOnly: el certificado lo genera el portal del SENIAT en PDF.
const IMG_PDF = 'image/png,image/jpeg,image/webp,application/pdf';
export const DOCS = {
  cedula: { label: 'Cédula de identidad', hint: 'Legible y vigente.', group: 'Identidad', step: 2, accept: IMG_PDF },
  rif: { label: 'RIF', hint: 'Vigente, con el domicilio fiscal actual.', group: 'Identidad', step: 2, accept: IMG_PDF },
  recibo: { label: 'Recibo de servicio', hint: 'Agua, luz o teléfono: que confirme la dirección del RIF.', group: 'Domicilio', step: 2, accept: IMG_PDF },
  firma_personal: { label: 'Firma personal o certificado de emprendimiento', hint: 'Si tu negocio está registrado. Si no, basta con cédula y RIF.', group: 'Registro del negocio', step: 2, accept: IMG_PDF, optional: true },
  acta: { label: 'Acta constitutiva', hint: 'Con sus datos de registro.', group: 'Empresa', step: 2, accept: IMG_PDF },
  acta_update: { label: 'Última actualización del acta', hint: 'La que tiene la junta directiva vigente.', group: 'Empresa', step: 2, accept: IMG_PDF },
  socios_cedula: { label: 'Cédula de cada socio', hint: 'Todas en un solo PDF o imagen.', group: 'Socios', step: 2, accept: IMG_PDF },
  socios_rif: { label: 'RIF de cada socio', hint: 'Todos en un solo PDF o imagen.', group: 'Socios', step: 2, accept: IMG_PDF },
  licencia: { label: 'Licencia de Actividad Económica', hint: 'Emitida por la alcaldía.', group: 'Empresa', step: 2, accept: IMG_PDF },
  cert_actividad: { label: 'Certificado de Actividad del SENIAT', hint: 'El PDF que genera el portal del SENIAT.', group: 'Actividad económica', step: 3, accept: 'application/pdf' },
};
// Debe coincidir con fiscal_required_docs() en la base.
export const docsFor = (person) => (person === 'juridica'
  ? ['acta', 'acta_update', 'rif', 'socios_cedula', 'socios_rif', 'licencia', 'cert_actividad']
  : ['cedula', 'rif', 'recibo', 'firma_personal', 'cert_actividad']);
export const requiredDocs = (person) => docsFor(person).filter((k) => !DOCS[k].optional);

export const RIF_RE = /^[VEJGPC]-?\d{8,9}$/i;
export const CI_RE = /^[VE]-?\d{5,9}$/i;
// "j123456789" → "J-123456789"
export const normDoc = (v) => {
  const t = (v || '').toUpperCase().replace(/[\s.]/g, '');
  const m = t.match(/^([VEJGPC])-?(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : t;
};

// Qué falta en cada paso (para el resumen del asistente y para habilitar "Continuar").
export function missingFor(fp, step) {
  const docs = fp.documents || {};
  const out = [];
  if (step === 2) {
    docsFor(fp.person_type).filter((k) => DOCS[k].step === 2 && !DOCS[k].optional && !docs[k]?.path)
      .forEach((k) => out.push(DOCS[k].label));
    if (!fp.legal_name?.trim()) out.push('razón social');
    if (!RIF_RE.test(fp.rif || '')) out.push('RIF del negocio');
    if (!fp.representative_name?.trim()) out.push(fp.person_type === 'juridica' ? 'representante legal' : 'tu nombre');
    if (!CI_RE.test(fp.representative_id || '')) out.push(fp.person_type === 'juridica' ? 'cédula del representante' : 'tu cédula');
    if (!fp.fiscal_address?.trim()) out.push('domicilio fiscal');
    if (!fp.main_activity?.trim()) out.push('actividad principal');
  }
  if (step === 3) {
    if (!docs.cert_actividad?.path) out.push(DOCS.cert_actividad.label);
  }
  if (step === 4) {
    if (!fp.signature_path) out.push('firma');
    if (fp.person_type === 'juridica' && !fp.seal_path) out.push('sello de la empresa');
  }
  return out;
}

// ---------- Libro de Ventas ----------
const n2 = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');
// Filas del Libro de Ventas (para downloadCsv): una por documento, en orden
// de emisión; las notas de crédito restan.
export function salesBookRows(invoices, { fmtDate }) {
  const head = ['Nº', 'Fecha', 'Tipo', 'Nº documento', 'Nº control', 'Doc. afectado', 'RIF/CI', 'Nombre o razón social',
    'Total Bs (con IVA)', 'Exento Bs', 'Base 16 % Bs', 'IVA 16 % Bs', 'Base 8 % Bs', 'IVA 8 % Bs', 'IGTF Bs', 'Tasa Bs/$', 'Total $'];
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const rows = [...invoices].sort((a, b) => new Date(a.issued_at) - new Date(b.issued_at)).map((i, k) => {
    const sign = i.doc_type === 'nota_credito' ? -1 : 1;
    const rel = i.related_invoice_id ? byId.get(i.related_invoice_id) : null;
    return [k + 1, fmtDate(i.issued_at), DOC_TITLES[i.doc_type], invoiceNo(i.number), i.control_number || 'Pendiente',
      rel ? invoiceNo(rel.number) : '', i.customer?.document, i.customer?.name,
      n2(sign * i.total_ves), n2(sign * i.exempt_ves), n2(sign * i.base_g_ves), n2(sign * i.iva_g_ves),
      n2(sign * i.base_r_ves), n2(sign * i.iva_r_ves), n2(sign * i.igtf_ves), n2(i.rate), n2(sign * i.total_usd)];
  });
  return [head, ...rows];
}

// Totales del período (las notas de crédito restan).
export function bookTotals(invoices) {
  const t = { count: 0, credit: 0, total: 0, base: 0, iva: 0, exempt: 0, usd: 0 };
  invoices.forEach((i) => {
    const s = i.doc_type === 'nota_credito' ? -1 : 1;
    if (i.doc_type === 'factura') t.count += 1; else if (i.doc_type === 'nota_credito') t.credit += 1;
    t.total += s * i.total_ves; t.exempt += s * i.exempt_ves;
    t.base += s * (Number(i.base_g_ves) + Number(i.base_r_ves));
    t.iva += s * (Number(i.iva_g_ves) + Number(i.iva_r_ves));
    t.usd += s * i.total_usd;
  });
  return t;
}
