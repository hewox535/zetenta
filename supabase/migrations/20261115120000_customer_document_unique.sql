/*
# Clientes: documento normalizado y único por negocio

- normalize_customer_document(): deja la cédula/RIF en un solo formato
  "V-12345678" (letra V/J/E/G/P + guion + números sin ceros a la izquierda).
  Solo números → se asume V. "0000000" o vacío → '' (sin documento).
- Trigger: todo alta o edición (POS, módulo Clientes, importación CSV) pasa
  por la normalización, así "v12345678", "V-12.345.678" y "12345678" son el mismo.
- Se normalizan los documentos ya guardados y se fusionan los duplicados que
  quedan: se conserva el cliente más antiguo, se le completan teléfono/correo
  vacíos con los de los duplicados y sus pedidos y deudas pasan a él.
- Índice único (business_id, document) cuando hay documento: el mismo cliente
  ya no se puede registrar dos veces en un negocio.
*/

CREATE OR REPLACE FUNCTION public.normalize_customer_document(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN s ~ '^[VJEGP]?0*$'       THEN ''
    WHEN s ~ '^[VJEGP][0-9]+$'    THEN left(s, 1) || '-' || ltrim(substr(s, 2), '0')
    WHEN s ~ '^[0-9]+$'           THEN 'V-' || ltrim(s, '0')
    ELSE upper(btrim(COALESCE(p, '')))
  END
  FROM (SELECT upper(regexp_replace(COALESCE(p, ''), '[^A-Za-z0-9]', '', 'g')) AS s) z
$$;

CREATE OR REPLACE FUNCTION public.customers_normalize_document()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.document := public.normalize_customer_document(NEW.document);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_customers_normalize_document ON customers;
CREATE TRIGGER trg_customers_normalize_document
  BEFORE INSERT OR UPDATE OF document ON customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_normalize_document();

-- ---------- Normaliza lo existente ----------
UPDATE customers SET document = public.normalize_customer_document(document)
 WHERE document IS DISTINCT FROM public.normalize_customer_document(document);

-- ---------- Fusiona duplicados (se queda el más antiguo) ----------
CREATE TEMP TABLE _cust_dup ON COMMIT DROP AS
SELECT id AS dup_id, keep_id FROM (
  SELECT id,
         first_value(id) OVER (PARTITION BY business_id, document ORDER BY created_at, id) AS keep_id
    FROM customers
   WHERE document <> ''
) t
WHERE id <> keep_id;

-- Completa datos vacíos del que se conserva con los de sus duplicados.
UPDATE customers k SET
  phone = COALESCE(NULLIF(k.phone, ''), (SELECT c.phone FROM _cust_dup d JOIN customers c ON c.id = d.dup_id
                                          WHERE d.keep_id = k.id AND c.phone <> '' ORDER BY c.created_at LIMIT 1), ''),
  email = COALESCE(NULLIF(k.email, ''), (SELECT c.email FROM _cust_dup d JOIN customers c ON c.id = d.dup_id
                                          WHERE d.keep_id = k.id AND c.email <> '' ORDER BY c.created_at LIMIT 1), '')
WHERE k.id IN (SELECT keep_id FROM _cust_dup);

UPDATE orders o SET customer_id = d.keep_id FROM _cust_dup d WHERE o.customer_id = d.dup_id;
UPDATE debts  x SET customer_id = d.keep_id FROM _cust_dup d WHERE x.customer_id = d.dup_id;
DELETE FROM customers c USING _cust_dup d WHERE c.id = d.dup_id;

-- ---------- Único por negocio ----------
CREATE UNIQUE INDEX IF NOT EXISTS customers_business_document_key
  ON customers (business_id, document) WHERE document <> '';

NOTIFY pgrst, 'reload schema';
