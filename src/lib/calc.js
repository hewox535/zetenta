// Cálculos del comprobante de retención de IVA.
// Replica las fórmulas del sheet original:
//   base imponible = total con IVA / 1.16   (generalizado: (total - exento) / (1 + alícuota))
//   impuesto IVA   = base * alícuota
//   IVA retenido   = impuesto * % retención
// Igual que Excel: los valores se mantienen sin redondear y solo se redondean
// al mostrarlos (money); redondear pasos intermedios desvía los totales un céntimo.

export function calcLinea(linea) {
  const total = Number(linea.totalConIva) || 0;
  const exento = Number(linea.exento) || 0;
  const alicuota = Number(linea.alicuota) || 0;
  const pctRetencion = Number(linea.pctRetencion) || 0;

  const base = (total - exento) / (1 + alicuota / 100);
  const iva = base * (alicuota / 100);
  const retenido = iva * (pctRetencion / 100);
  return { base, iva, retenido };
}

export function calcTotales(lineas) {
  let totalCompra = 0;
  let totalRetenido = 0;
  for (const l of lineas) {
    totalCompra += Number(l.totalConIva) || 0;
    totalRetenido += calcLinea(l).retenido;
  }
  return { totalCompra, totalRetenido, totalAPagar: totalCompra - totalRetenido };
}

const fmt = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(n) {
  return fmt.format(Number(n) || 0);
}

// Número de comprobante SENIAT: AAAAMM + secuencial de 8 dígitos
export function numeroComprobante(periodo, seq) {
  return `${periodo}${String(seq).padStart(8, '0')}`;
}

// periodo AAAAMM a partir de una fecha ISO (yyyy-mm-dd)
export function periodoDeFecha(fechaISO) {
  return fechaISO.slice(0, 7).replace('-', '');
}

export function formatFecha(fechaISO) {
  if (!fechaISO) return '';
  const [y, m, d] = fechaISO.split('-');
  return `${d}/${m}/${y}`;
}
