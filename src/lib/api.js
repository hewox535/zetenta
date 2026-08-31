import { supabase } from './supabaseClient';

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// ---------- Perfil y negocio ----------

export async function fetchProfile(userId) {
  return unwrap(await supabase.from('profiles').select('*').eq('id', userId).single());
}

// Cuenta propia: nombre visible y nombre de usuario (único; puede quedar vacío).
export async function updateMyProfile(userId, { fullName, username }) {
  return unwrap(await supabase.from('profiles')
    .update({
      full_name: fullName.trim(),
      username: username?.trim() ? username.trim().toLowerCase() : null,
    })
    .eq('id', userId).select().single());
}

// Cambio de correo de la sesión actual. Supabase envía un enlace de
// confirmación; el correo auth cambia al confirmarse. Actualizamos también la
// copia visible en profiles (puede ir un paso adelante hasta la confirmación).
export async function updateMyEmail(userId, email) {
  const { error } = await supabase.auth.updateUser({ email });
  if (error) throw new Error(error.message);
  unwrap(await supabase.from('profiles').update({ email }).eq('id', userId));
}

// Cambia la contraseña verificando antes la actual: se reautentica contra el
// correo auth de la sesión (funciona también con el correo sintético del
// personal sin correo real).
export async function updateMyPassword(currentPassword, newPassword) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (authErr) throw new Error('La contraseña actual no es correcta.');
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
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

// Corrige un comprobante ya emitido. Permite reasignar su correlativo (seq);
// el servidor rechaza uno que ya use otro comprobante.
export async function updateWithholding({ id, supplierId, issueDate, lines, seq }) {
  return unwrap(await supabase.rpc('update_withholding', {
    p_id: id,
    p_supplier_id: supplierId,
    p_issue_date: issueDate,
    p_lines: lines,
    p_seq: seq,
  }));
}

// Vía RPC para que, si se borra el último comprobante, el correlativo retroceda
// y el siguiente reutilice ese número.
export async function deleteWithholding(id) {
  unwrap(await supabase.rpc('delete_withholding', { p_id: id }));
}

// ---------- Sucursales ----------

export async function fetchBranches() {
  return unwrap(await supabase.from('branches').select('*').order('sort_order').order('created_at'));
}

export async function createBranch(businessId, { name, address }) {
  return unwrap(await supabase.from('branches')
    .insert({ business_id: businessId, name, address: address || '' }).select().single());
}

export async function updateBranch(id, patch) {
  return unwrap(await supabase.from('branches').update(patch).eq('id', id).select().single());
}

export async function deleteBranch(id) {
  unwrap(await supabase.from('branches').delete().eq('id', id));
}

// Traslado de stock entre sucursales (atómico, sin sobreventa en origen).
export async function transferStock({ variantId, fromBranch, toBranch, quantity, note }) {
  return unwrap(await supabase.rpc('transfer_stock', {
    p_variant_id: variantId, p_from: fromBranch, p_to: toBranch,
    p_qty: Number(quantity), p_note: note || '',
  }));
}

// Accesos de sucursal por usuario (todas las filas visibles según RLS).
export async function fetchUserBranches() {
  return unwrap(await supabase.from('user_branches').select('user_id, branch_id'));
}

export async function setUserBranches(userId, allBranches, branchIds) {
  return unwrap(await supabase.rpc('set_user_branches', {
    p_user: userId, p_all: allBranches, p_branch_ids: branchIds || [],
  }));
}

// ---------- Inventario ----------

export async function fetchProducts() {
  return unwrap(await supabase.from('products')
    .select('*, product_terms(term_id), product_variants(*, variant_stock(*)), product_media(*)').order('name'));
}

// ---------- Medios de producto (imágenes) ----------

// URL pública a partir de los metadatos guardados (provider/bucket/path).
// Centralizar aquí hace trivial migrar de storage: solo cambia este switch.
export function mediaUrl(media) {
  if (!media?.path) return null;
  if (media.provider === 'supabase' || !media.provider) {
    return supabase.storage.from(media.bucket || 'product-media').getPublicUrl(media.path).data.publicUrl;
  }
  return null;
}

// Reduce la imagen a máx. 1200px y la convierte a JPEG (ahorra storage/ancho de banda).
async function compressToBlob(file, maxSize = 1200) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
    return blob || file;
  } catch { return file; }
}

export async function uploadProductImage(businessId, productId, file, { variantId = null, sortOrder = 0 } = {}) {
  const blob = await compressToBlob(file);
  const path = `${businessId}/${productId}/${crypto.randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage.from('product-media')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (upErr) throw new Error(upErr.message);
  return unwrap(await supabase.from('product_media')
    .insert({ business_id: businessId, product_id: productId, variant_id: variantId,
      provider: 'supabase', bucket: 'product-media', path, sort_order: sortOrder })
    .select().single());
}

export async function deleteProductMedia(media) {
  if ((media.provider === 'supabase' || !media.provider) && media.path) {
    await supabase.storage.from(media.bucket || 'product-media').remove([media.path]);
  }
  unwrap(await supabase.from('product_media').delete().eq('id', media.id));
}

export async function createProduct(businessId, { name, sku, unit, price, variantAxes }) {
  return unwrap(await supabase.from('products')
    .insert({ business_id: businessId, name, sku, unit, price, variant_axes: variantAxes || [] })
    .select().single());
}

// Alta atómica: producto + categorías + variaciones con stock inicial.
// categories: { taxonomyName: value }   variants: [{ attributes, sku, price, stock }]
export async function createProductWithVariants({ name, sku, unit, price, categories, variantAxes, variants, branchId }) {
  return unwrap(await supabase.rpc('create_product_with_variants', {
    p_name: name,
    p_sku: sku || '',
    p_unit: unit || 'und',
    p_price: Number(price) || 0,
    p_categories: categories || {},
    p_variant_axes: variantAxes || [],
    p_variants: variants || [],
    p_branch_id: branchId || null,
  }));
}

export async function addProductVariant(productId, { attributes, sku, price, stock, branchId }) {
  return unwrap(await supabase.rpc('add_product_variant', {
    p_product_id: productId,
    p_attributes: attributes || {},
    p_sku: sku || '',
    p_price: price ?? null,
    p_stock: Number(stock) || 0,
    p_branch_id: branchId || null,
  }));
}

export async function updateProduct(id, patch) {
  return unwrap(await supabase.from('products')
    .update(patch).eq('id', id).select().single());
}

// Editar datos del producto + reemplazar sus categorías (atómico).
export async function updateProductDetails(id, { name, sku, unit, price, categories }) {
  return unwrap(await supabase.rpc('update_product_details', {
    p_id: id, p_name: name, p_sku: sku || '', p_unit: unit || 'und',
    p_price: Number(price) || 0, p_categories: categories || {},
  }));
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

export async function fetchMovements(limit = 30, { productId, type } = {}) {
  let q = supabase.from('inventory_movements')
    .select('*, products(name), product_variants(attributes)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (productId) q = q.eq('product_id', productId);
  if (type) q = q.eq('type', type);
  return unwrap(await q);
}

export async function createMovement(businessId, { productId, variantId, type, quantity, note, branchId }) {
  return unwrap(await supabase.from('inventory_movements')
    .insert({ business_id: businessId, product_id: productId, variant_id: variantId, type, quantity, note, branch_id: branchId || null })
    .select().single());
}

// ---------- Taxonomías de productos ----------

export async function fetchTaxonomies() {
  return unwrap(await supabase.from('taxonomies')
    .select('*, taxonomy_terms(*)').order('created_at'));
}

export async function createTaxonomy(businessId, name, kind = 'category') {
  return unwrap(await supabase.from('taxonomies')
    .insert({ business_id: businessId, name, kind }).select('*, taxonomy_terms(*)').single());
}

export async function deleteTaxonomy(id) {
  unwrap(await supabase.from('taxonomies').delete().eq('id', id));
}

export async function deleteTerm(id) {
  unwrap(await supabase.from('taxonomy_terms').delete().eq('id', id));
}

export async function createTerm(taxonomyId, name) {
  return unwrap(await supabase.from('taxonomy_terms')
    .insert({ taxonomy_id: taxonomyId, name }).select().single());
}

export async function updateTerm(id, name) {
  return unwrap(await supabase.from('taxonomy_terms')
    .update({ name }).eq('id', id).select().single());
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

// ---------- Cuentas bancarias y sus métodos de pago ----------

// Cuentas con sus métodos. Una cuenta sin métodos se usa como método en sí.
export async function fetchBankAccounts() {
  return unwrap(await supabase.from('bank_accounts')
    .select('*, payment_methods(*)').order('sort_order').order('created_at'));
}

export async function createBankAccount(businessId, { name, currency, openingBalance, details }) {
  return unwrap(await supabase.from('bank_accounts')
    .insert({ business_id: businessId, name, currency, opening_balance: Number(openingBalance) || 0, details: details || {} })
    .select('*, payment_methods(*)').single());
}

export async function updateBankAccount(id, patch) {
  return unwrap(await supabase.from('bank_accounts')
    .update(patch).eq('id', id).select('*, payment_methods(*)').single());
}

export async function deleteBankAccount(id) {
  unwrap(await supabase.from('bank_accounts').delete().eq('id', id));
}

export async function createPaymentMethod(businessId, accountId, { name, description, currency }) {
  return unwrap(await supabase.from('payment_methods')
    .insert({ business_id: businessId, account_id: accountId, name, description: description || '', currency })
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

// Descuento por pago en divisa (%) y umbral de stock bajo (%).
export async function updateBusinessSettings({ foreignDiscountPercent, lowStockPercent }) {
  return unwrap(await supabase.rpc('update_business_settings', {
    p_foreign_discount_percent: foreignDiscountPercent,
    p_low_stock_percent: lowStockPercent,
  }));
}

// ---------- Personal del negocio (roles) ----------

export async function fetchStaff() {
  return unwrap(await supabase.from('profiles')
    .select('id, full_name, email, username, business_role, role, all_branches')
    .not('business_id', 'is', null)
    .order('full_name'));
}

export async function createStaff({ username, email, password, fullName }) {
  const { data, error } = await supabase.functions.invoke('staff', {
    body: { action: 'create', username, email, password, full_name: fullName },
  });
  if (error) {
    let msg = error.message;
    try { const b = await error.context.json(); if (b?.error) msg = b.error; } catch { /* sin JSON */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data.user;
}

export async function deleteStaff(userId) {
  const { data, error } = await supabase.functions.invoke('staff', {
    body: { action: 'delete', user_id: userId },
  });
  if (error) {
    let msg = error.message;
    try { const b = await error.context.json(); if (b?.error) msg = b.error; } catch { /* sin JSON */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
}

export async function setStaffRole(userId, role) {
  return unwrap(await supabase.rpc('set_staff_role', { p_user: userId, p_role: role }));
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

// Alta masiva (importación CSV). rows: [{ name, document, phone, email }]
export async function createCustomersBulk(businessId, rows) {
  if (!rows.length) return [];
  return unwrap(await supabase.from('customers')
    .insert(rows.map((r) => ({
      business_id: businessId, name: r.name,
      document: r.document || '', phone: r.phone || '', email: r.email || '',
    })))
    .select());
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
export async function createOrder({ items, payments, rate, rateSource, customerId, customerName, note, branchId }) {
  return unwrap(await supabase.rpc('create_order', {
    p_items: items,
    p_payments: payments,
    p_rate: rate,
    p_rate_source: rateSource,
    p_customer_name: customerName || '',
    p_note: note || '',
    p_customer_id: customerId || null,
    p_branch_id: branchId || null,
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

// Activos de marca (logo/favicon): se suben al bucket público 'branding' (solo
// platform_admin puede escribir; ver migración branding_assets). Se conservan
// como PNG para no perder transparencia; SVG se sube tal cual. El favicon se
// limita a 512px (suficiente para pantalla de inicio) y el logo a 1024px.
async function toPngBlob(file, maxSize) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    return blob || file;
  } catch { return file; }
}

export async function uploadBrandingAsset(businessId, file, kind) {
  const isSvg = file.type === 'image/svg+xml';
  const blob = isSvg ? file : await toPngBlob(file, kind === 'favicon' ? 512 : 1024);
  const ext = isSvg ? 'svg' : 'png';
  const path = `${businessId}/${kind}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('branding')
    .upload(path, blob, { contentType: isSvg ? 'image/svg+xml' : 'image/png', upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from('branding').getPublicUrl(path).data.publicUrl;
}

// White label: el administrador configura dominio y marca de cada negocio.
// slug / custom_domain vacíos se guardan como NULL (para no romper el índice único).
export async function updateBusinessBranding(id, { slug, customDomain, branding, capabilities }) {
  const patch = {
    slug: slug?.trim() ? slug.trim().toLowerCase() : null,
    custom_domain: customDomain?.trim() ? customDomain.trim().toLowerCase() : null,
    branding: branding || {},
  };
  if (capabilities) patch.capabilities = capabilities;
  return unwrap(await supabase.from('businesses')
    .update(patch)
    .eq('id', id).select().single());
}
