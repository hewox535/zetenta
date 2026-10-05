/*
# Roma: cuenta y método de pago Cashea

Deja a Roma lista para cobrar con Cashea: una cuenta en bolívares llamada
"Cashea" (es donde Cashea abona la inicial y las cuotas) con un único método
del mismo nombre marcado como compra a cuotas (kind = 'cashea').

Al cobrar, ese método muestra los niveles del cliente (60/50/40 % de inicial)
y se queda con la parte que financia Cashea; la inicial se cobra con el
método que use el cliente. Esa parte no recibe el descuento por pago en
divisa (ver 20261003120000_cashea_payment_method.sql).

Idempotente: solo actúa si Roma existe y aún no tiene esa cuenta o ese
método. Data operativa; va como migración por ser el único canal de
ejecución en el remoto, igual que 20260831160000_roma_ropa.sql.
*/

DO $$
DECLARE
  bid uuid;
  acc uuid;
BEGIN
  SELECT id INTO bid FROM businesses WHERE slug = 'roma';
  IF bid IS NULL THEN
    RAISE NOTICE 'No existe el negocio roma; nada que hacer.';
    RETURN;
  END IF;

  SELECT id INTO acc FROM bank_accounts
   WHERE business_id = bid AND lower(name) = 'cashea';
  IF acc IS NULL THEN
    INSERT INTO bank_accounts (business_id, name, currency, sort_order)
    VALUES (bid, 'Cashea', 'VES',
            COALESCE((SELECT max(sort_order) + 1 FROM bank_accounts WHERE business_id = bid), 0))
    RETURNING id INTO acc;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM payment_methods
     WHERE business_id = bid AND account_id = acc AND kind = 'cashea'
  ) THEN
    INSERT INTO payment_methods (business_id, account_id, name, currency, kind)
    VALUES (bid, acc, 'Cashea', 'VES', 'cashea');
  END IF;

  RAISE NOTICE 'Cashea configurado para Roma.';
END $$;
