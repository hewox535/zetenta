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

// Qué tipos de notificación push quiere recibir este usuario.
export async function updateNotificationPrefs(userId, prefs) {
  return unwrap(await supabase.from('profiles')
    .update({ notification_prefs: prefs }).eq('id', userId).select().single());
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
// categories: { taxonomyName: value }   variants: [{ attributes, sku, price, cost, stock }]
export async function createProductWithVariants({ name, sku, unit, price, cost, note, categories, variantAxes, variants, branchId }) {
  return unwrap(await supabase.rpc('create_product_with_variants', {
    p_name: name,
    p_sku: sku || '',
    p_unit: unit || 'und',
    p_price: Number(price) || 0,
    p_cost: Number(cost) || 0,
    p_note: note || '',
    p_categories: categories || {},
    p_variant_axes: variantAxes || [],
    p_variants: variants || [],
    p_branch_id: branchId || null,
  }));
}

export async function addProductVariant(productId, { attributes, sku, price, cost, stock, branchId }) {
  return unwrap(await supabase.rpc('add_product_variant', {
    p_product_id: productId,
    p_attributes: attributes || {},
    p_sku: sku || '',
    p_price: price ?? null,
    p_cost: cost ?? null,
    p_stock: Number(stock) || 0,
    p_branch_id: branchId || null,
  }));
}

export async function updateProduct(id, patch) {
  return unwrap(await supabase.from('products')
    .update(patch).eq('id', id).select().single());
}

// Editar datos del producto + reemplazar sus categorías (atómico).
export async function updateProductDetails(id, { name, sku, unit, price, cost, note, categories }) {
  return unwrap(await supabase.rpc('update_product_details', {
    p_id: id, p_name: name, p_sku: sku || '', p_unit: unit || 'und',
    p_price: Number(price) || 0, p_cost: Number(cost) || 0, p_note: note || '',
    p_categories: categories || {},
  }));
}

export async function deleteProduct(id) {
  unwrap(await supabase.from('products').delete().eq('id', id));
}

// Aplica la oferta a varios productos: un % (1–99) o un precio fijo en USD.
// Sin ninguno de los dos, se les quita la oferta.
export async function setProductsOffer(ids, { percent = null, price = null } = {}) {
  return unwrap(await supabase.rpc('set_products_offer', {
    p_ids: ids, p_percent: percent, p_price: price,
  }));
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

// Variantes de un producto (para emparejar las fotos recién subidas con la
// variante que les toca, después de crear el producto).
export async function fetchProductVariants(productId) {
  return unwrap(await supabase.from('product_variants')
    .select('id, attributes').eq('product_id', productId));
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

// Cliente en la venta: si es obligatorio y qué datos exige al crearlo del POS.
export async function updateCustomerConfig(customerConfig) {
  return unwrap(await supabase.rpc('update_customer_config', { p_customer_config: customerConfig }));
}

// Descuentos de contado (%) en divisa y en bolívares, y umbral de stock bajo (%).
// Sin localDiscountPercent, el descuento en bolívares no se toca.
export async function updateBusinessSettings({ foreignDiscountPercent, lowStockPercent, localDiscountPercent }) {
  return unwrap(await supabase.rpc('update_business_settings', {
    p_foreign_discount_percent: foreignDiscountPercent,
    p_low_stock_percent: lowStockPercent,
    p_local_discount_percent: localDiscountPercent ?? null,
  }));
}

// Inicial de Cashea que trae el POS por defecto (%).
export async function setCasheaInitialPercent(percent) {
  return unwrap(await supabase.rpc('set_cashea_initial_percent', { p_percent: Number(percent) }));
}

// ---------- Personal del negocio (roles) ----------

export async function fetchStaff() {
  return unwrap(await supabase.from('profiles')
    .select('id, full_name, email, username, business_role, role, all_branches, permissions')
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

// Permisos por módulo de una vendedora (inventory/stats/retentions).
export async function setStaffPermissions(userId, permissions) {
  return unwrap(await supabase.rpc('set_staff_permissions', { p_user: userId, p_permissions: permissions }));
}

// ---------- Sesiones abiertas del negocio (solo administrador) ----------

export async function fetchBusinessSessions() {
  return unwrap(await supabase.rpc('list_business_sessions'));
}

export async function revokeBusinessSession(sessionId) {
  return unwrap(await supabase.rpc('revoke_business_session', { p_session: sessionId }));
}

// userId null → todas las del negocio (menos la sesión actual).
export async function revokeBusinessSessions(userId = null) {
  return unwrap(await supabase.rpc('revoke_business_sessions', { p_user: userId }));
}

// false si el administrador cerró esta sesión desde otro dispositivo.
export async function isSessionAlive() {
  const { data, error } = await supabase.rpc('session_alive');
  if (error) return true; // ante un error de red no se cierra nada
  return data !== false;
}

// ---------- Clientes ----------

export async function fetchCustomers() {
  return unwrap(await supabase.from('customers').select('*').order('name'));
}

// El documento es único por negocio (índice customers_business_document_key):
// el error de duplicado de Postgres se traduce a un mensaje claro.
function customerResult(res) {
  if (res.error?.code === '23505') {
    throw new Error('Ya existe un cliente registrado con ese documento.');
  }
  return unwrap(res);
}

export async function createCustomer(businessId, { name, document, phone, email }) {
  return customerResult(await supabase.from('customers')
    .insert({ business_id: businessId, name, document: document || '', phone: phone || '', email: email || '' })
    .select().single());
}

// Alta masiva (importación CSV). rows: [{ name, document, phone, email }]
export async function createCustomersBulk(businessId, rows) {
  if (!rows.length) return [];
  return customerResult(await supabase.from('customers')
    .insert(rows.map((r) => ({
      business_id: businessId, name: r.name,
      document: r.document || '', phone: r.phone || '', email: r.email || '',
    })))
    .select());
}

export async function updateCustomer(id, patch) {
  return customerResult(await supabase.from('customers')
    .update(patch).eq('id', id).select().single());
}

export async function deleteCustomer(id) {
  unwrap(await supabase.from('customers').delete().eq('id', id));
}

// ---------- Pedidos ----------

// items: [{ variant_id, quantity }]   payments: [{ method_id, method_name, currency, amount }]
// creditDue (yyyy-mm-dd): lo que no se cobre queda como cuenta por cobrar del
// cliente, con ese vencimiento.
export async function createOrder({ items, payments, rate, rateSource, customerId, customerName, note, branchId, creditDue, foreignDiscount, localDiscount }) {
  return unwrap(await supabase.rpc('create_order', {
    p_items: items,
    p_payments: payments,
    p_rate: rate,
    p_rate_source: rateSource,
    p_customer_name: customerName || '',
    p_note: note || '',
    p_customer_id: customerId || null,
    p_branch_id: branchId || null,
    p_credit_due: creditDue || null,
    // % de descuento de contado de esta venta (si no van, el servidor usa los del negocio)
    p_foreign_discount: foreignDiscount ?? null,
    p_local_discount: localDiscount ?? null,
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

// Cancelar una venta hecha por error: pide el PIN de seguridad, devuelve el
// stock y deja la venta marcada (ver 20261006120000_cancel_order_pin.sql).
export async function cancelOrder(orderId, pin, reason) {
  return unwrap(await supabase.rpc('cancel_order', {
    p_order_id: orderId, p_pin: pin, p_reason: reason || '',
  }));
}

export async function setCancelPin(pin) {
  return unwrap(await supabase.rpc('set_cancel_pin', { p_pin: pin }));
}

export async function hasCancelPin() {
  return unwrap(await supabase.rpc('has_cancel_pin'));
}

// Pedidos con ítems y pagos en un rango de fechas, para estadísticas. Las
// canceladas no cuentan: no son ventas.
export async function fetchOrdersForStats(fromISO, toISO) {
  let q = supabase.from('orders')
    .select('*, order_items(*), order_payments(*)')
    .is('cancelled_at', null)
    .order('created_at', { ascending: false });
  if (fromISO) q = q.gte('created_at', fromISO);
  if (toISO) q = q.lte('created_at', toISO);
  return unwrap(await q);
}

// Cobros de cuentas por cobrar (abonos de ventas a crédito y otras deudas a
// favor) hechos en el período. Requiere el permiso de Cuentas (RLS).
export async function fetchReceivablePayments(fromISO, toISO) {
  let q = supabase.from('debt_payments')
    .select('amount_usd, created_at, debts!inner(kind, branch_id, order_id)')
    .eq('debts.kind', 'receivable');
  if (fromISO) q = q.gte('created_at', fromISO);
  if (toISO) q = q.lte('created_at', toISO);
  return unwrap(await q);
}

// ---------- Administración de la plataforma ----------

export async function fetchBusinesses() {
  return unwrap(await supabase.from('businesses').select('*').order('created_at'));
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

// ---------- Caja: apertura, movimientos y cierre ----------

// La caja abierta de una sucursal, si hay alguna. Sin sucursal (negocio de un
// solo local) se busca la que no tiene branch_id o la única abierta.
export async function fetchOpenCashSession(branchId) {
  let q = supabase.from('cash_sessions')
    .select('*, cash_session_lines(*), cash_movements(*)')
    .is('closed_at', null);
  q = branchId ? q.eq('branch_id', branchId) : q.is('branch_id', null);
  const rows = unwrap(await q.limit(1));
  return rows[0] || null;
}

// Cierres anteriores, para el historial.
export async function fetchCashSessions(branchId, limit = 30) {
  let q = supabase.from('cash_sessions')
    .select('*, cash_session_lines(*)')
    .not('closed_at', 'is', null)
    .order('closed_at', { ascending: false }).limit(limit);
  if (branchId) q = q.eq('branch_id', branchId);
  return unwrap(await q);
}

// Lo que lleva la caja hasta ahora, calculado en el servidor (la misma cuenta
// que congela el cierre).
export async function fetchCashReport(sessionId) {
  return unwrap(await supabase.rpc('cash_session_report', { p_session_id: sessionId }));
}

// opening: [{ account_id, amount }] con el fondo inicial de cada cuenta.
export async function openCashSession(branchId, opening, note) {
  return unwrap(await supabase.rpc('open_cash_session', {
    p_branch_id: branchId || null, p_opening: opening || [], p_note: note || '',
  }));
}

export async function addCashMovement(sessionId, accountId, direction, amount, reason) {
  return unwrap(await supabase.rpc('add_cash_movement', {
    p_session_id: sessionId, p_account_id: accountId,
    p_direction: direction, p_amount: Number(amount), p_reason: reason || '',
  }));
}

export async function deleteCashMovement(id) {
  unwrap(await supabase.rpc('delete_cash_movement', { p_id: id }));
}

// counted: [{ account_id, amount }] con lo que se contó de verdad.
export async function closeCashSession(sessionId, counted, rate, note) {
  return unwrap(await supabase.rpc('close_cash_session', {
    p_session_id: sessionId, p_counted: counted || [],
    p_rate: Number(rate) || 0, p_note: note || '',
  }));
}

// Cuántas ventas de la sucursal quedaron fuera de toda caja (se vendió con la
// caja cerrada). Sirve para avisar, no para cuadrar.
export async function countOrphanOrders(branchId, sinceISO) {
  let q = supabase.from('orders').select('id', { count: 'exact', head: true })
    .is('cash_session_id', null).is('cancelled_at', null);
  if (branchId) q = q.eq('branch_id', branchId);
  if (sinceISO) q = q.gte('created_at', sinceISO);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count || 0;
}

// ---------- Sello del negocio en los comprobantes de retención ----------

// Sube la imagen del sello a la carpeta del negocio. Se guarda como PNG para
// conservar el fondo transparente: así se ve como un sello puesto sobre el
// papel y no como un recuadro blanco encima del formato.
export async function uploadStamp(businessId, file) {
  const blob = await toPngBlob(file, 1000);
  const path = `${businessId}/sello-${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage.from('stamps')
    .upload(path, blob, { contentType: 'image/png', upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from('stamps').getPublicUrl(path).data.publicUrl;
}

// Guarda el sello del negocio; con '' se quita.
export async function setStampUrl(url) {
  return unwrap(await supabase.rpc('set_stamp_url', { p_url: url || '' }));
}

// Si ESE comprobante se imprime con el sello. Va aparte de update_withholding
// porque es presentación, no contenido fiscal: ponerle el sello a uno viejo no
// reescribe sus líneas ni toca el correlativo.
export async function setWithholdingStamped(id, stamped) {
  return unwrap(await supabase.rpc('set_withholding_stamped', { p_id: id, p_stamped: !!stamped }));
}

// ---------- Catálogo público ----------

// Ajustes del catálogo del negocio (solo administrador): publicado o no,
// WhatsApp de contacto y frase bajo el título.
export async function setCatalogSettings({ enabled, whatsapp, tagline }) {
  return unwrap(await supabase.rpc('set_catalog_settings', {
    p_enabled: !!enabled, p_whatsapp: whatsapp || '', p_tagline: tagline || '',
  }));
}

// Catálogo público de un negocio (sin sesión). Devuelve null si el negocio no
// lo ha publicado. Nunca trae stock: solo disponible/agotado por variante.
export async function fetchPublicCatalog(businessId) {
  const { data, error } = await supabase.rpc('get_public_catalog', { p_business: businessId });
  if (error) throw new Error(error.message);
  return data || null;
}

// Resuelve la marca de un negocio por slug (para ver su catálogo desde el
// dominio de la plataforma con ?tienda=slug, cuando no hay dominio propio).
export async function fetchBrandBySlug(slug) {
  const { data, error } = await supabase.rpc('get_branding', { p_host: `${slug}.x` });
  if (error) throw new Error(error.message);
  const b = Array.isArray(data) ? data[0] : data;
  return b || null;
}

// ---------- Avisos de vencimientos (badge del menú) ----------

export async function fetchFinanceAlerts() {
  return unwrap(await supabase.rpc('finance_alerts'));
}

// ---------- Cuentas por cobrar y por pagar ----------

export async function fetchDebts() {
  return unwrap(await supabase.from('debts')
    .select('*, debt_payments(*), orders(number), expenses(name)')
    .is('cancelled_at', null)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('issue_date', { ascending: true }));
}

export async function createDebt({ kind, partyType, customerId, supplierId, partyName, concept, amountUsd, issueDate, dueDate, note, branchId }) {
  return unwrap(await supabase.rpc('create_debt', {
    p_kind: kind, p_party_type: partyType,
    p_customer_id: customerId || null, p_supplier_id: supplierId || null,
    p_party_name: partyName || '', p_concept: concept || '',
    p_amount_usd: Number(amountUsd), p_issue_date: issueDate || null,
    p_due_date: dueDate || null, p_note: note || '', p_branch_id: branchId || null,
  }));
}

export async function updateDebt(id, { concept, amountUsd, dueDate, note }) {
  return unwrap(await supabase.rpc('update_debt', {
    p_id: id, p_concept: concept || '', p_amount_usd: Number(amountUsd),
    p_due_date: dueDate || null, p_note: note || '',
  }));
}

export async function deleteDebt(id) {
  unwrap(await supabase.rpc('delete_debt', { p_id: id }));
}

// amount va en la moneda de la cuenta; se reparte de la que vence primero a la última.
export async function payDebts(debtIds, accountId, amount, rate, note) {
  return unwrap(await supabase.rpc('pay_debts', {
    p_debt_ids: debtIds, p_account_id: accountId, p_amount: Number(amount),
    p_rate: Number(rate) || 0, p_note: note || '',
  }));
}

export async function deleteDebtPayment(id) {
  unwrap(await supabase.rpc('delete_debt_payment', { p_id: id }));
}

// ---------- Gastos ----------

export async function fetchExpenses(fromISO, toISO) {
  let q = supabase.from('expenses').select('*')
    .order('spent_on', { ascending: false }).order('created_at', { ascending: false });
  if (fromISO) q = q.gte('spent_on', fromISO);
  if (toISO) q = q.lte('spent_on', toISO);
  return unwrap(await q);
}

export async function createExpense(payload) {
  return unwrap(await supabase.rpc('create_expense', { p: payload }));
}

export async function updateExpense(id, patch) {
  return unwrap(await supabase.from('expenses').update(patch).eq('id', id).select().single());
}

export async function deleteExpense(id) {
  unwrap(await supabase.rpc('delete_expense', { p_id: id }));
}

export async function fetchExpenseCategories() {
  return unwrap(await supabase.from('expense_categories').select('*').order('sort_order').order('name'));
}

export async function createExpenseCategory(businessId, name) {
  return unwrap(await supabase.from('expense_categories')
    .insert({ business_id: businessId, name: name.trim(), sort_order: 100 }).select().single());
}

export async function fetchRecurringExpenses() {
  return unwrap(await supabase.from('recurring_expenses').select('*').order('next_due'));
}

export async function createRecurringExpense(businessId, row) {
  return unwrap(await supabase.from('recurring_expenses')
    .insert({ business_id: businessId, ...row }).select().single());
}

export async function updateRecurringExpense(id, patch) {
  return unwrap(await supabase.from('recurring_expenses').update(patch).eq('id', id).select().single());
}

export async function deleteRecurringExpense(id) {
  unwrap(await supabase.from('recurring_expenses').delete().eq('id', id));
}

// Comprobante del gasto: carpeta privada del negocio; se ve con un enlace temporal.
export async function uploadExpenseReceipt(businessId, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${businessId}/${crypto.randomUUID()}.${ext || 'jpg'}`;
  const { error } = await supabase.storage.from('expense-receipts')
    .upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return path;
}

export async function expenseReceiptUrl(path) {
  const { data, error } = await supabase.storage.from('expense-receipts').createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// Ventas netas de un período (para comparar gastos contra ingresos).
export async function fetchSalesTotal(fromISO, toISO) {
  const rows = unwrap(await supabase.from('orders')
    .select('total_usd, discount_usd, created_at')
    .is('cancelled_at', null)
    .gte('created_at', fromISO).lt('created_at', toISO));
  return rows.reduce((s, o) => s + Number(o.total_usd) - Number(o.discount_usd || 0), 0);
}
