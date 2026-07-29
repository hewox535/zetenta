/*
# Tasa BCV guardada en la base de datos y refrescada por cron

En vez de que cada navegador consulte la API de SyPago, la plataforma guarda la
tasa oficial del BCV en `bcv_rates` y la refresca dos veces al día con pg_cron:
7:00 y 14:00 hora de Venezuela (UTC-4) → 11:00 y 18:00 UTC.

- bcv_rates: una fila por día (USD y EUR). El refresco de la tarde sobrescribe
  el de la mañana con el valor más reciente.
- refresh_bcv_rate(): consulta SyPago con la extensión http (síncrona), parsea y
  hace upsert de la fila de hoy. SECURITY DEFINER; la escriben solo el cron y la
  siembra inicial.
- La tasa es un dato público e igual para todos los negocios, así que la tabla
  no lleva business_id; cualquier usuario autenticado puede leerla.
*/

CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE bcv_rates (
  rate_date date PRIMARY KEY,
  usd numeric(18,6) NOT NULL,
  eur numeric(18,6),
  load_date timestamptz,               -- fecha de carga que reporta el BCV
  fetched_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bcv_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY bcv_rates_select ON bcv_rates FOR SELECT TO authenticated USING (true);

-- ---------- Refresco de la tasa desde SyPago ----------
CREATE OR REPLACE FUNCTION public.refresh_bcv_rate()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  body jsonb;
  r jsonb;
  v_usd numeric;
  v_eur numeric;
  v_load timestamptz;
BEGIN
  SELECT content::jsonb INTO body
  FROM extensions.http_get('https://api.sypago.net/api/v1/bank/bcv/rate');

  FOR r IN SELECT * FROM jsonb_array_elements(body) LOOP
    IF r->>'code' = 'USD' THEN
      v_usd := (r->>'rate')::numeric;
      v_load := NULLIF(r->>'load_date', '')::timestamptz;
    ELSIF r->>'code' = 'EUR' THEN
      v_eur := (r->>'rate')::numeric;
    END IF;
  END LOOP;

  IF v_usd IS NULL THEN RAISE EXCEPTION 'BCV response missing USD rate'; END IF;

  INSERT INTO bcv_rates (rate_date, usd, eur, load_date)
  VALUES (current_date, v_usd, v_eur, v_load)
  ON CONFLICT (rate_date) DO UPDATE
    SET usd = EXCLUDED.usd, eur = EXCLUDED.eur, load_date = EXCLUDED.load_date, fetched_at = now();
END $$;

-- ---------- Programación (dos veces al día, hora Venezuela UTC-4) ----------
SELECT cron.schedule('bcv-rate-morning',   '0 11 * * *', $$SELECT public.refresh_bcv_rate();$$);  -- 7:00 VET
SELECT cron.schedule('bcv-rate-afternoon', '0 18 * * *', $$SELECT public.refresh_bcv_rate();$$);  -- 14:00 VET

-- ---------- Siembra inmediata (sin romper la migración si SyPago falla) ----------
DO $$
BEGIN
  PERFORM public.refresh_bcv_rate();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Siembra inicial de tasa BCV fallida: %', SQLERRM;
END $$;
