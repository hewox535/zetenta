// Tasa de cambio BCV (bolívares por divisa).
//
// Fuente de verdad: la tabla `bcv_rates` de nuestra base de datos, que un cron
// refresca dos veces al día (7:00 y 14:00 hora de Venezuela) desde la API del
// BCV vía SyPago. La app lee esa tasa; solo si todavía no hay fila (p. ej. el
// primer arranque) consulta la API en vivo como respaldo.

import { supabase } from './supabaseClient';

const LIVE_API = 'https://api.sypago.net/api/v1/bank/bcv/rate';

async function fetchLive() {
  const res = await fetch(LIVE_API);
  if (!res.ok) throw new Error('No se pudo obtener la tasa del BCV');
  const list = await res.json();
  const rates = { load_date: null };
  for (const r of list) {
    if (r.code === 'USD' || r.code === 'EUR') {
      rates[r.code] = Number(r.rate);
      rates.load_date = rates.load_date || r.load_date;
    }
  }
  if (!rates.USD) throw new Error('La tasa BCV no incluye USD');
  return rates;
}

// Devuelve { USD, EUR, load_date, rate_date }. Prefiere la tasa guardada en BD.
export async function fetchBcvRates() {
  const { data, error } = await supabase
    .from('bcv_rates')
    .select('usd, eur, load_date, rate_date')
    .order('rate_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data?.usd) {
    return {
      USD: Number(data.usd),
      EUR: data.eur != null ? Number(data.eur) : 0,
      load_date: data.load_date,
      rate_date: data.rate_date,
    };
  }
  // Respaldo: aún no hay tasa guardada
  return fetchLive();
}

// Resuelve la tasa efectiva (Bs por 1 USD de precio) según la configuración del
// negocio y las tasas BCV vigentes.
//   rateConfig: { mode: 'bcv', currency: 'USD'|'EUR' } | { mode: 'manual', value: number }
// Devuelve { value, source, label }.
export function resolveRate(rateConfig, bcvRates) {
  const cfg = rateConfig || { mode: 'bcv', currency: 'USD' };
  if (cfg.mode === 'manual') {
    return { value: Number(cfg.value) || 0, source: 'manual', label: 'Tasa manual' };
  }
  const currency = cfg.currency === 'EUR' ? 'EUR' : 'USD';
  const value = bcvRates?.[currency] || 0;
  return {
    value,
    source: currency === 'EUR' ? 'bcv_eur' : 'bcv_usd',
    label: currency === 'EUR' ? 'BCV EUR' : 'BCV USD',
  };
}
