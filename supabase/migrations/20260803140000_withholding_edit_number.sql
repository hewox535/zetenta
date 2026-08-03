/*
# Editar el correlativo de un comprobante

Amplía update_withholding() para poder corregir el número (correlativo) de un
comprobante ya emitido, por si quedó mal asignado. El correlativo son los
últimos 8 dígitos del número; el período (YYYYMM) sigue derivándose de la fecha.

Reglas:
- No se permite un correlativo que ya use OTRO comprobante del mismo negocio
  (se compara por el número de secuencia, sin importar el mes).
- Tras fijar un correlativo manual, el contador se mantiene por delante
  (GREATEST) para que las próximas emisiones automáticas no choquen. Nunca lo
  baja, así que corregir un número hacia abajo (142 → 141) no altera el contador.
*/

DROP FUNCTION IF EXISTS public.update_withholding(uuid, uuid, date, jsonb);

CREATE OR REPLACE FUNCTION public.update_withholding(
  p_id uuid, p_supplier_id uuid, p_issue_date date, p_lines jsonb, p_seq integer
)
RETURNS withholdings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bid uuid := public.current_business_id();
  b businesses%ROWTYPE;
  s suppliers%ROWTYPE;
  w withholdings%ROWTYPE;
  period text;
  l jsonb;
  i integer := 0;
BEGIN
  SELECT * INTO b FROM businesses WHERE id = bid;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No business for current user'; END IF;
  IF NOT COALESCE((b.capabilities->>'retentions')::boolean, false) THEN
    RAISE EXCEPTION 'Retentions capability is disabled for this business';
  END IF;
  SELECT * INTO w FROM withholdings WHERE id = p_id AND business_id = bid FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Withholding not found'; END IF;
  SELECT * INTO s FROM suppliers WHERE id = p_supplier_id AND business_id = bid;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Supplier not found'; END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one line is required';
  END IF;
  IF p_seq IS NULL OR p_seq < 1 OR p_seq > 99999999 THEN
    RAISE EXCEPTION 'El correlativo no es válido.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM withholdings
    WHERE business_id = bid AND id <> w.id AND right(number, 8)::integer = p_seq
  ) THEN
    RAISE EXCEPTION 'El correlativo % ya existe en otro comprobante.', p_seq;
  END IF;

  period := to_char(p_issue_date, 'YYYYMM');
  UPDATE withholdings
     SET issue_date = p_issue_date,
         fiscal_period = period,
         number = period || lpad(p_seq::text, 8, '0'),
         supplier_id = s.id,
         supplier_name = s.name,
         supplier_rif = s.rif
   WHERE id = w.id
   RETURNING * INTO w;

  -- Mantiene el contador por delante del correlativo fijado (nunca lo baja).
  UPDATE businesses SET withholding_seq = GREATEST(withholding_seq, p_seq + 1) WHERE id = bid;

  DELETE FROM withholding_lines WHERE withholding_id = w.id;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    i := i + 1;
    INSERT INTO withholding_lines (
      withholding_id, line_number, operation_date, invoice_number, control_number,
      debit_note, credit_note, transaction_type, affected_document,
      total_with_vat, exempt_amount, vat_rate, retention_rate
    ) VALUES (
      w.id, i,
      COALESCE(NULLIF(l->>'operation_date', '')::date, p_issue_date),
      COALESCE(l->>'invoice_number', ''),
      COALESCE(l->>'control_number', ''),
      COALESCE(l->>'debit_note', ''),
      COALESCE(l->>'credit_note', ''),
      COALESCE(NULLIF(l->>'transaction_type', ''), '01-Reg.'),
      COALESCE(l->>'affected_document', ''),
      COALESCE(NULLIF(l->>'total_with_vat', '')::numeric, 0),
      COALESCE(NULLIF(l->>'exempt_amount', '')::numeric, 0),
      COALESCE(NULLIF(l->>'vat_rate', '')::numeric, 16),
      COALESCE(NULLIF(l->>'retention_rate', '')::numeric, 75)
    );
  END LOOP;
  RETURN w;
END $$;

GRANT EXECUTE ON FUNCTION public.update_withholding(uuid, uuid, date, jsonb, integer) TO authenticated;
