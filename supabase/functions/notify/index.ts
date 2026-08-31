// API: notificaciones push del negocio. Tras registrar una venta, el cliente
// llama con el order_id y aquí se decide a quién avisar:
//
//   - "sale": a los administradores del negocio (menos quien registró la
//     venta), si tienen la preferencia activa.
//   - "low_stock": si algún ítem de la venta dejó una variante en stock bajo
//     (stock <= target_stock * low_stock_percent/100), a todos los
//     administradores con la preferencia activa.
//
//   POST /functions/v1/notify
//   Authorization: Bearer <access_token>   (+ header apikey)
//   Body JSON: { order_id }
//   200 → { ok: true, sent }   4xx/5xx → { error }
//
// Envía Web Push (VAPID) a cada suscripción registrada del destinatario y
// elimina las suscripciones caducadas (404/410). Secretos: VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

const fmtUsd = (n: number) => `$${Number(n).toFixed(2)}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Usa POST.' }, 405);

  try {
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT')!,
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    );

    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    );
    const { data: userData, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Token inválido.' }, 401);

    const { data: me } = await asUser
      .from('profiles').select('id, business_id, full_name').eq('id', userData.user.id).single();
    if (!me?.business_id) return json({ error: 'Tu usuario no tiene negocio.' }, 403);

    const body = await req.json().catch(() => null);
    const orderId = String(body?.order_id || '');
    if (!orderId) return json({ error: 'Falta order_id.' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: order } = await admin.from('orders')
      .select('id, business_id, number, customer_name, total_usd, order_items(variant_id, name, variant_label, quantity)')
      .eq('id', orderId).single();
    if (!order || order.business_id !== me.business_id) return json({ error: 'Venta no encontrada.' }, 404);

    const { data: business } = await admin.from('businesses')
      .select('name, low_stock_percent, branding').eq('id', order.business_id).single();

    // Destinatarios: administradores del negocio con sus preferencias.
    const { data: admins } = await admin.from('profiles')
      .select('id, notification_prefs')
      .eq('business_id', order.business_id).eq('business_role', 'admin');

    // Stock bajo entre las variantes vendidas en esta venta.
    const variantIds = (order.order_items || []).map((i: { variant_id: string | null }) => i.variant_id).filter(Boolean);
    let lowLines: string[] = [];
    if (variantIds.length && Number(business?.low_stock_percent) > 0) {
      const { data: variants } = await admin.from('product_variants')
        .select('id, stock, target_stock, products(name)')
        .in('id', variantIds);
      const pct = Number(business!.low_stock_percent);
      for (const v of variants || []) {
        const t = Number(v.target_stock);
        if (v.target_stock != null && t > 0 && Number(v.stock) <= (t * pct) / 100) {
          const item = (order.order_items || []).find((i: { variant_id: string | null }) => i.variant_id === v.id);
          const label = item?.variant_label ? ` (${item.variant_label})` : '';
          lowLines.push(`${(v.products as { name: string } | null)?.name || item?.name || 'Producto'}${label}: quedan ${Number(v.stock)}`);
        }
      }
    }

    const icon = (business?.branding as Record<string, string> | null)?.favicon_url
      || (business?.branding as Record<string, string> | null)?.logo_url || undefined;

    // Un push por (destinatario, tipo, suscripción).
    const jobs: { userId: string; payload: string }[] = [];
    for (const a of admins || []) {
      const prefs = (a.notification_prefs || {}) as Record<string, boolean>;
      if (a.id !== me.id && prefs.sale !== false) {
        jobs.push({
          userId: a.id,
          payload: JSON.stringify({
            title: `Nueva venta #${order.number}`,
            body: `${fmtUsd(order.total_usd)}${order.customer_name ? ` · ${order.customer_name}` : ''}${me.full_name ? ` · por ${me.full_name}` : ''}`,
            tag: `sale-${order.id}`, url: `/orders/${order.id}`, icon,
          }),
        });
      }
      if (lowLines.length && prefs.low_stock !== false) {
        jobs.push({
          userId: a.id,
          payload: JSON.stringify({
            title: `⚠ Stock bajo (${lowLines.length})`,
            body: lowLines.slice(0, 4).join('\n'),
            tag: `low-stock-${order.id}`, url: '/inventory', icon,
          }),
        });
      }
    }
    if (!jobs.length) return json({ ok: true, sent: 0 });

    const userIds = [...new Set(jobs.map((j) => j.userId))];
    const { data: subs } = await admin.from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth').in('user_id', userIds);

    let sent = 0;
    const dead: string[] = [];
    await Promise.all((subs || []).flatMap((s) =>
      jobs.filter((j) => j.userId === s.user_id).map(async (j) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            j.payload,
          );
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) dead.push(s.id);
        }
      })
    ));
    if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead);

    return json({ ok: true, sent });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
