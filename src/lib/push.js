import { supabase } from './supabaseClient';

// Notificaciones push del navegador. La suscripción es por dispositivo/navegador:
// se guarda en push_subscriptions y la Edge Function 'notify' envía a todas las
// del destinatario. En iOS solo funciona con la app agregada a la pantalla de
// inicio (iOS 16.4+).

// Llave pública VAPID (la privada vive como secreto de la Edge Function).
const VAPID_PUBLIC_KEY = 'BJRlbAK0x3kbRvpdmcspRoel6IRdUyHC5pbeKhP2euJMwgSOLPp2-T-Sq4fLAhKaaDDluIVuvkPmw5G9poD5NE0';

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function getRegistration() {
  return navigator.serviceWorker.register('/sw.js');
}

// ¿Este dispositivo ya está suscrito?
export async function isPushEnabled() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  return !!(reg && await reg.pushManager.getSubscription());
}

export async function enablePush(profile) {
  if (!pushSupported()) throw new Error('Este navegador no soporta notificaciones push.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permiso de notificaciones denegado. Actívalo en la configuración del navegador.');
  const reg = await getRegistration();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const j = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: profile.id,
    business_id: profile.business_id,
    endpoint: sub.endpoint,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth,
  }, { onConflict: 'endpoint' });
  if (error) throw new Error(error.message);
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

// Aviso de venta registrada: fuego y olvido, nunca bloquea el flujo del POS.
export function notifySale(orderId) {
  supabase.functions.invoke('notify', { body: { order_id: orderId } }).catch(() => {});
}
