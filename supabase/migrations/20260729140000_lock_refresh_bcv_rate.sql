/*
# Restringe refresh_bcv_rate() al cron

Por defecto las funciones son ejecutables por PUBLIC. refresh_bcv_rate() hace
peticiones HTTP salientes y escribe en bcv_rates; no debe poder dispararla
cualquier cliente con la anon key. Solo el cron (que corre como el dueño de la
función) debe ejecutarla.
*/

REVOKE ALL ON FUNCTION public.refresh_bcv_rate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_bcv_rate() FROM anon;
REVOKE ALL ON FUNCTION public.refresh_bcv_rate() FROM authenticated;
