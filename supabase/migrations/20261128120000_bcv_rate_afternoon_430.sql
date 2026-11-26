/*
# Tasa BCV: la actualización de la tarde pasa a las 4:30 p. m.

El BCV publica la tasa del día siguiente a primera hora de la tarde, pero no
siempre antes de las 2:00 p. m. Se mueve la segunda corrida a las 4:30 p. m.
hora de Venezuela (UTC-4 → 20:30 UTC). La de la mañana sigue a las 7:00 a. m.
(11:00 UTC). cron.schedule con el mismo nombre reemplaza el trabajo.
*/
SELECT cron.schedule('bcv-rate-afternoon', '30 20 * * *', $$SELECT public.refresh_bcv_rate();$$);  -- 16:30 VET
SELECT cron.schedule('bcv-rate-morning',   '0 11 * * *',  $$SELECT public.refresh_bcv_rate();$$);  -- 7:00 VET
