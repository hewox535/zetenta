/*
# Editar y eliminar comprobantes con numeración coherente

Dos cambios sobre las retenciones:

1. delete_withholding(): al eliminar un comprobante, si era el ÚLTIMO emitido
   (su número == withholding_seq - 1), retrocede el correlativo para que el
   siguiente reutilice ese número. Antes, borrar el 141 dejaba el contador en
   142 y la siguiente retención salía 142 en vez de 141. Solo retrocede cuando
   se borra desde el tope; borrar uno intermedio deja el hueco (no se puede
   reutilizar un número del medio sin duplicar).

2. update_withholding(): permite corregir un comprobante ya emitido (fecha,
   proveedor, líneas) CONSERVANDO su número. Reemplaza las líneas por completo.
   Pensado para corregir datos y volver a imprimir el mismo comprobante.

El correlativo se guarda en el propio número: number = YYYYMM || lpad(seq, 8),
así que el seq son los últimos 8 dígitos.
*/

-- ---------- Eliminar comprobante y liberar su número si era el último ----------
CREATE OR REPLACE FUNCTION public.delete_withholding(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bid uuid := public.current_business_id();
  w_seq integer;
BEGIN
  SELECT right(number, 8)::integer INTO w_seq
  FROM withholdings
  WHERE id = p_id AND business_id = bid;
  IF w_seq IS NULL THEN RAISE EXCEPTION 'Withholding not found'; END IF;

  DELETE FROM withholdings WHERE id = p_id AND business_id = bid;

  -- Si era el último comprobante emitido, libera su número para reutilizarlo.
  UPDATE businesses
     SET withholding_seq = w_seq
   WHERE id = bid AND withholding_seq = w_seq + 1;
END $$;

GRANT EXECUTE ON FUNCTION public.delete_withholding(uuid) TO authenticated;

-- ---------- Actualizar un comprobante existente (conserva su número) ----------
CREATE OR REPLACE FUNCTION public.update_withholding(
  p_id uuid, p_supplier_id uuid, p_issue_date date, p_lines jsonb
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

  period := to_char(p_issue_date, 'YYYYMM');
  UPDATE withholdings
     SET issue_date = p_issue_date,
         fiscal_period = period,
         supplier_id = s.id,
         supplier_name = s.name,
         supplier_rif = s.rif
   WHERE id = w.id
   RETURNING * INTO w;

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

GRANT EXECUTE ON FUNCTION public.update_withholding(uuid, uuid, date, jsonb) TO authenticated;
