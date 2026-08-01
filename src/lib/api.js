import { supabase } from './supabaseClient';

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// ---------- Perfil y negocio ----------

export async function fetchProfile(userId) {
  return unwrap(await supabase.from('profiles').select('*').eq('id', userId).single());
}

export async function fetchBusiness(businessId) {
  return unwrap(await supabase.from('businesses').select('*').eq('id', businessId).single());
}

export async function updateBusinessProfile({ name, rif, fiscalAddress }) {
  return unwrap(await supabase.rpc('update_business_profile', {
    p_name: name,
    p_rif: rif,
    p_fiscal_address: fiscalAddress,
  }));
}

// Ajusta la numeración: se indica el último número ya emitido, el siguiente
// comprobante usará p_last + 1.
export async function setWithholdingSeq(lastNumber) {
  return unwrap(await supabase.rpc('set_withholding_seq', { p_last: lastNumber }));
}

// ---------- Proveedores ----------

export async function fetchSuppliers() {
  return unwrap(await supabase.from('suppliers').select('*').order('name'));
}

export async function createSupplier(businessId, { name, rif }) {
  return unwrap(await supabase.from('suppliers')
    .insert({ business_id: businessId, name, rif }).select().single());
}

export async function updateSupplier(id, { name, rif }) {
  return unwrap(await supabase.from('suppliers')
    .update({ name, rif }).eq('id', id).select().single());
}

export async function deleteSupplier(id) {
  unwrap(await supabase.from('suppliers').delete().eq('id', id));
}

// ---------- Retenciones ----------

export async function fetchWithholdings() {
  return unwrap(await supabase.from('withholdings')
    .select('*, withholding_lines(*)')
    .order('created_at', { ascending: false }));
}

export async function fetchWithholding(id) {
  return unwrap(await supabase.from('withholdings')
    .select('*, withholding_lines(*)').eq('id', id).single());
}

export async function createWithholding({ supplierId, issueDate, lines }) {
  return unwrap(await supabase.rpc('create_withholding', {
    p_supplier_id: supplierId,
    p_issue_date: issueDate,
    p_lines: lines,
  }));
}

export async function deleteWithholding(id) {
  unwrap(await supabase.from('withholdings').delete().eq('id', id));
}

// ---------- Inventario ----------

export async function fetchProducts() {
  return unwrap(await supabase.from('products')
    .select('*, product_terms(term_id), product_variants(*)').order('name'));
}

export async function createProduct(businessId, { name, sku, unit, price, variantAxes }) {
  return unwrap(await supabase.from('products')
    .insert({ business_id: businessId, name, sku, unit, price, variant_axes: variantAxes || [] })
    .select().single());
}

export async function updateProduct(id, patch) {
  return unwrap(await supabase.from('products')
    .update(patch).eq('id', id).select().single());
}

export async function deleteProduct(id) {
  unwrap(await supabase.from('products').delete().eq('id', id));
}

// ---------- Variantes de producto ----------

export async function createVariant(businessId, productId, { sku, price, stock, attributes }) {
  return unwrap(await supabase.from('product_variants')
    .insert({
      business_id: businessId, product_id: productId,
      sku: sku || '', price: price ?? null, stock: stock ?? 0, attributes: attributes || {},
    })
    .select().single());
}

export async function updateVariant(id, patch) {
  return unwrap(await supabase.from('product_variants')
    .update(patch).eq('id', id).select().single());
}

export async function deleteVariant(id) {
  unwrap(await supabase.from('product_variants').delete().eq('id', id));
}

export async function fetchMovements(limit = 30) {
  return unwrap(await supabase.from('inventory_movements')
    .select('*, products(name), product_variants(attributes)')
    .order('created_at', { ascending: false })
    .limit(limit));
}

export async function createMovement(businessId, { productId, variantId, type, quantity, note }) {
  return unwrap(await supabase.from('inventory_movements')
    .insert({ business_id: businessId, product_id: productId, variant_id: variantId, type, quantity, note })
    .select().single());
}

// ---------- Taxonomías de productos ----------

export async function fetchTaxonomies() {
  return unwrap(await supabase.from('taxonomies')
    .select('*, taxonomy_terms(*)').order('created_at'));
}

export async function createTaxonomy(businessId, name) {
  return unwrap(await supabase.from('taxonomies')
    .insert({ business_id: businessId, name }).select('*, taxonomy_terms(*)').single());
}

export async function deleteTaxonomy(id) {
  unwrap(await supabase.from('taxonomies').delete().eq('id', id));
}

export async function deleteTerm(id) {
  unwrap(await supabase.from('taxonomy_terms').delete().eq('id', id));
}

// Devuelve el término con ese nombre, creándolo si no existe.
export async function findOrCreateTerm(taxonomyId, name) {
  return unwrap(await supabase.from('taxonomy_terms')
    .upsert({ taxonomy_id: taxonomyId, name }, { onConflict: 'taxonomy_id,name' })
    .select().single());
}

export async function setProductTerms(productId, termIds) {
  if (termIds.length === 0) return;
  unwrap(await supabase.from('product_terms')
    .insert(termIds.map((term_id) => ({ product_id: productId, term_id }))));
}

// ---------- Extracción de facturas con IA ----------

// Reduce la foto a ~1600px por lado y la convierte a JPEG base64
// (suficiente para leer la factura y mucho más barato de procesar).
async function compressImage(file, maxSize = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

export async function extractInvoice(file) {
  const image = await compressImage(file);
  const { data, error } = await supabase.functions.invoke('extract-invoice', {
    body: { image, mimeType: 'image/jpeg' },
  });
  if (error) {
    let msg = error.message;
    try {
      const body = await error.context.json();
      if (body?.error) msg = body.error;
    } catch { /* respuesta sin JSON */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data.extracted;
}

// ---------- Métodos de pago ----------

export async function fetchPaymentMethods() {
  return unwrap(await supabase.from('payment_methods')
    .select('*').order('sort_order').order('created_at'));
}

export async function createPaymentMethod(businessId, { name, currency, details }) {
  return unwrap(await supabase.from('payment_methods')
    .insert({ business_id: businessId, name, currency, details: details || {} })
    .select().single());
}

export async function updatePaymentMethod(id, patch) {
  return unwrap(await supabase.from('payment_methods')
    .update(patch).eq('id', id).select().single());
}

export async function deletePaymentMethod(id) {
  unwrap(await supabase.from('payment_methods').delete().eq('id', id));
}

// ---------- Ajustes de pedidos (tasa de cambio) ----------

export async function updateOrderSettings(rateConfig) {
  return unwrap(await supabase.rpc('update_order_settings', { p_rate_config: rateConfig }));
}

// ---------- Clientes ----------

export async function fetchCustomers() {
  return unwrap(await supabase.from('customers').select('*').order('name'));
}

export async function createCustomer(businessId, { name, document, phone, email }) {
  return unwrap(await supabase.from('customers')
    .insert({ business_id: businessId, name, document: document || '', phone: phone || '', email: email || '' })
    .select().single());
}

export async function updateCustomer(id, patch) {
  return unwrap(await supabase.from('customers')
    .update(patch).eq('id', id).select().single());
}

export async function deleteCustomer(id) {
  unwrap(await supabase.from('customers').delete().eq('id', id));
}

// ---------- Pedidos ----------

// items: [{ variant_id, quantity }]   payments: [{ method_id, method_name, currency, amount }]
export async function createOrder({ items, payments, rate, rateSource, customerId, customerName, note }) {
  return unwrap(await supabase.rpc('create_order', {
    p_items: items,
    p_payments: payments,
    p_rate: rate,
    p_rate_source: rateSource,
    p_customer_name: customerName || '',
    p_note: note || '',
    p_customer_id: customerId || null,
  }));
}

export async function fetchOrders() {
  return unwrap(await supabase.from('orders')
    .select('*, order_payments(*)')
    .order('created_at', { ascending: false }));
}

export async function fetchOrder(id) {
  return unwrap(await supabase.from('orders')
    .select('*, order_items(*), order_payments(*)').eq('id', id).single());
}

// Pedidos con ítems y pagos en un rango de fechas, para estadísticas.
export async function fetchOrdersForStats(fromISO, toISO) {
  let q = supabase.from('orders')
    .select('*, order_items(*), order_payments(*)')
    .order('created_at', { ascending: false });
  if (fromISO) q = q.gte('created_at', fromISO);
  if (toISO) q = q.lte('created_at', toISO);
  return unwrap(await q);
}

// ---------- Administración de la plataforma ----------

export async function fetchBusinesses() {
  return unwrap(await supabase.from('businesses').select('*').order('created_at'));
}

export async function updateBusinessCapabilities(id, capabilities) {
  return unwrap(await supabase.from('businesses')
    .update({ capabilities }).eq('id', id).select().single());
}

// White label: el administrador configura dominio y marca de cada negocio.
// slug / custom_domain vacíos se guardan como NULL (para no romper el índice único).
export async function updateBusinessBranding(id, { slug, customDomain, branding }) {
  return unwrap(await supabase.from('businesses')
    .update({
      slug: slug?.trim() ? slug.trim().toLowerCase() : null,
      custom_domain: customDomain?.trim() ? customDomain.trim().toLowerCase() : null,
      branding: branding || {},
    })
    .eq('id', id).select().single());
}
