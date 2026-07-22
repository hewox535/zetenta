// Cálculos del comprobante de retención de IVA.
// Igual que Excel: los valores se mantienen sin redondear y solo se redondean
// al mostrarlos (money); redondear pasos intermedios desvía los totales un céntimo.

export function calcLine(line) {
  const total = Number(line.total_with_vat) || 0;
  const exempt = Number(line.exempt_amount) || 0;
  const vatRate = Number(line.vat_rate) || 0;
  const retentionRate = Number(line.retention_rate) || 0;

  const base = (total - exempt) / (1 + vatRate / 100);
  const vat = base * (vatRate / 100);
  const withheld = vat * (retentionRate / 100);
  return { base, vat, withheld };
}

export function calcTotals(lines) {
  let totalPurchase = 0;
  let totalWithheld = 0;
  for (const l of lines) {
    totalPurchase += Number(l.total_with_vat) || 0;
    totalWithheld += calcLine(l).withheld;
  }
  return { totalPurchase, totalWithheld, totalPayable: totalPurchase - totalWithheld };
}

const fmt = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(n) {
  return fmt.format(Number(n) || 0);
}

// yyyy-mm-dd → dd/mm/yyyy
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
