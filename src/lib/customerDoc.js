// Cédula/RIF en un solo formato: "V-12345678". Es el mismo criterio que la
// función normalize_customer_document() de la base de datos (que además lo
// aplica con un trigger), para detectar duplicados antes de guardar.
export function normalizeDoc(raw) {
  const s = String(raw || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (/^[VJEGP]?0*$/.test(s)) return '';
  if (/^[VJEGP][0-9]+$/.test(s)) return `${s[0]}-${s.slice(1).replace(/^0+/, '')}`;
  if (/^[0-9]+$/.test(s)) return `V-${s.replace(/^0+/, '')}`;
  return String(raw || '').trim().toUpperCase();
}

// Cliente ya registrado con ese documento (o null).
export function findByDoc(customers, raw, exceptId = null) {
  const d = normalizeDoc(raw);
  if (!d) return null;
  return (customers || []).find((c) => c.id !== exceptId && normalizeDoc(c.document) === d) || null;
}
