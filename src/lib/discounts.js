// Descuentos especiales (Black Friday, liquidaciones…): el negocio los crea
// en Negocio → Ventas y la cajera elige uno en el cobro. Las fechas se leen en
// hora de Venezuela, igual que create_order() en el servidor.

// Fecha de hoy en Venezuela (YYYY-MM-DD).
export function todayVE() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());
}

// Estado de un descuento según sus fechas: 'off' | 'soon' | 'live' | 'ended'.
export function discountStatus(ds, today = todayVE()) {
  if (!ds.active) return 'off';
  if (ds.starts_on && ds.starts_on > today) return 'soon';
  if (ds.ends_on && ds.ends_on < today) return 'ended';
  return 'live';
}

export const isLive = (ds, today) => discountStatus(ds, today) === 'live';
