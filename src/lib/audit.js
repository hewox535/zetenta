// Cómo se muestra el historial de cambios (audit_log): nombres de campos,
// formato de valores, tipos de cambio y textos de cada acción.
import { usd, formatDate } from './calc';

const MODULES = {
  orders: 'Ventas', cash: 'Caja', inventory: 'Inventario', accounts: 'Cuentas', expenses: 'Gastos',
  stats: 'Estadísticas', customers: 'Clientes', campaigns: 'Campañas', retentions: 'Retenciones',
};
const PERMS = {
  ...MODULES, inv_create: 'crear productos', inv_delete: 'borrar productos', inv_edit_info: 'editar datos',
  inv_edit_media: 'editar fotos', inv_edit_price: 'editar precios', inv_edit_stock: 'editar cantidades',
};

export const FIELD = {
  name: 'Nombre', sku: 'SKU', unit: 'Unidad', price: 'Precio', cost: 'Costo', note: 'Nota',
  offer_percent: 'Oferta', offer_price: 'Precio de oferta', track_stock: 'Controlar inventario',
  variant_axes: 'Variaciones', attributes: 'Variación', active: 'Estado', target_stock: 'Stock objetivo',
  available: 'Disponibilidad', term: 'Etiqueta', path: 'Foto',
  cash_percent: 'Descuento de contado', cashea_percent: 'Descuento con Cashea', starts_on: 'Desde', ends_on: 'Hasta', term_ids: 'Categorías',
  currency: 'Moneda', opening_balance: 'Saldo inicial', is_cash: 'Es efectivo', details: 'Datos de la cuenta', description: 'Descripción', kind: 'Tipo',
  address: 'Dirección', is_default: 'Principal',
  full_name: 'Nombre', username: 'Usuario', business_role: 'Rol', permissions: 'Permisos', all_branches: 'Todas las sucursales',
  rif: 'RIF', fiscal_address: 'Dirección fiscal', rate_config: 'Tasa de cambio', foreign_discount_percent: 'Descuento en divisa',
  local_discount_percent: 'Descuento en bolívares', low_stock_percent: 'Aviso de stock bajo', customer_config: 'Cliente en la venta',
  catalog_enabled: 'Catálogo en línea', catalog_whatsapp: 'WhatsApp del catálogo', catalog_tagline: 'Frase del catálogo',
  cashea_initial_percent: 'Inicial de Cashea', cash_mode: 'Modo de caja', branding: 'Marca', slug: 'Subdominio',
  custom_domain: 'Dominio propio', capabilities: 'Módulos', status: 'Estado del negocio', stamp_url: 'Sello',
  amount: 'Monto', amount_usd: 'Monto en $', spent_on: 'Fecha', account_name: 'Pagado con', supplier_name: 'Proveedor',
  frequency: 'Frecuencia', document: 'Documento', phone: 'Teléfono', email: 'Correo',
};

const PCT = new Set(['offer_percent', 'cash_percent', 'cashea_percent', 'foreign_discount_percent', 'local_discount_percent', 'low_stock_percent', 'cashea_initial_percent']);
const MONEY = new Set(['price', 'cost', 'offer_price', 'amount_usd']);
const DATES = new Set(['starts_on', 'ends_on', 'spent_on']);
const ENUMS = {
  active: { true: 'Activo', false: 'Inactivo' },
  available: { true: 'Disponible', false: 'Agotado' },
  business_role: { admin: 'Administrador', seller: 'Vendedora' },
  cash_mode: { daily: 'Cierre del día', shift: 'Abrir y cerrar caja' },
  status: { pending: 'Pendiente', active: 'Activo', disabled: 'Desactivado', paid: 'Pagado' },
  kind: { fixed: 'Fijo', variable: 'Variable', normal: 'Normal', cashea: 'Cashea' },
  frequency: { monthly: 'Mensual', biweekly: 'Quincenal', weekly: 'Semanal', yearly: 'Anual' },
};

const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
const onKeys = (obj, dict) => Object.entries(obj || {}).filter(([, on]) => on === true).map(([k]) => dict[k] || k);

// Valor legible de un campo. Devuelve '—' si está vacío.
export function fmtValue(field, v) {
  if (isEmpty(v)) return '—';
  if (MONEY.has(field)) return usd(Number(v));
  if (PCT.has(field)) return `${Number(v).toLocaleString('es-VE')}%`;
  if (DATES.has(field)) return formatDate(v);
  if (ENUMS[field] && String(v) in ENUMS[field]) return ENUMS[field][String(v)];
  if (field === 'attributes') return Object.values(v).join(' · ') || 'Estándar';
  if (field === 'permissions') return onKeys(v, PERMS).join(', ') || 'Ninguno';
  if (field === 'capabilities') return onKeys(v, MODULES).join(', ') || 'Ninguno';
  if (field === 'rate_config') return v.mode === 'manual' ? `Manual · ${Number(v.value || 0).toLocaleString('es-VE')} Bs/$` : `BCV en ${v.currency === 'EUR' ? 'euros' : 'dólares'}`;
  if (field === 'branding') return [v.name, v.accent].filter(Boolean).join(' · ') + (v.logo_url ? ' · con logo' : '');
  if (field === 'customer_config') return [v.required && 'cliente obligatorio', v.fields?.document && 'documento', v.fields?.phone && 'teléfono'].filter(Boolean).join(', ') || 'Opcional';
  if (field === 'term_ids') return `${v.length} ${v.length === 1 ? 'categoría' : 'categorías'}`;
  if (field === 'variant_axes') return v.join(', ');
  if (field === 'path') return 'Foto';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'object') return Array.isArray(v) ? v.join(', ') : 'Actualizado';
  if (typeof v === 'number') return v.toLocaleString('es-VE');
  return String(v);
}

// Tipo de un cambio de producto (para los filtros de Inventario → Historial).
export const CHANGE_TYPES = [
  ['all', 'Todos'], ['price', 'Precios'], ['info', 'Datos'], ['variants', 'Variaciones'],
  ['media', 'Fotos'], ['available', 'Disponibilidad'], ['life', 'Altas y bajas'],
];
const PRICE_FIELDS = new Set(['price', 'cost', 'offer_percent', 'offer_price']);
export function typesOf(e) {
  const t = new Set();
  if (e.entity === 'product_media') t.add('media');
  else if (e.entity === 'variant_stock') t.add('available');
  else if (e.action !== 'update' && (e.entity === 'products' || e.entity === 'product_variants')) {
    t.add('life'); if (e.entity === 'product_variants') t.add('variants');
  } else {
    for (const f of Object.keys(e.changes || {})) {
      if (PRICE_FIELDS.has(f)) t.add('price');
      else if (e.entity === 'product_variants') t.add('variants');
      else t.add('info');
    }
  }
  return t;
}

export const AREAS = [
  ['all', 'Todo'], ['productos', 'Productos'], ['descuentos', 'Descuentos'], ['cobros', 'Cuentas de cobro'],
  ['sucursales', 'Sucursales'], ['personal', 'Personal'], ['configuracion', 'Configuración'], ['gastos', 'Gastos'], ['clientes', 'Clientes'],
];

const NOUN = {
  products: 'el producto', product_variants: 'la variación', discounts: 'el descuento', bank_accounts: 'la cuenta',
  payment_methods: 'el método de cobro', branches: 'la sucursal', profiles: 'el usuario', expenses: 'el gasto',
  recurring_expenses: 'el gasto fijo', customers: 'el cliente', businesses: 'la configuración',
};
// Frase de la acción: "Creó el producto", "Agregó una foto", "Editó"…
export function actionText(e) {
  if (e.entity === 'product_media') return e.action === 'insert' ? 'Agregó una foto' : 'Quitó una foto';
  if (e.entity === 'product_terms') {
    const [, to] = e.changes?.term || [];
    return to ? `Agregó la etiqueta ${to}` : `Quitó la etiqueta ${(e.changes?.term || [])[0]}`;
  }
  if (e.entity === 'variant_stock') return 'Cambió la disponibilidad';
  const noun = NOUN[e.entity] || '';
  if (e.action === 'insert') return `Creó ${noun}`.trim();
  if (e.action === 'delete') return `Eliminó ${noun}`.trim();
  return 'Editó';
}

// Líneas de detalle "campo: antes → después". En altas y bajas solo lo esencial.
const ESSENTIAL = ['price', 'cost', 'sku', 'cash_percent', 'cashea_percent', 'amount', 'amount_usd', 'attributes', 'currency'];
export function changeLines(e) {
  if (e.entity === 'product_media' || e.entity === 'product_terms') return [];
  const entries = Object.entries(e.changes || {});
  const pick = e.action === 'update' ? entries : entries.filter(([f]) => ESSENTIAL.includes(f));
  return pick.map(([f, [from, to]]) => ({
    field: f, label: FIELD[f] || f,
    from: e.action === 'insert' ? null : fmtValue(f, from),
    to: e.action === 'delete' ? null : fmtValue(f, to),
  }));
}

// Iniciales para el avatar de quien hizo el cambio.
export const initialsOf = (name) => (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'S';
