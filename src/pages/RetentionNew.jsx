import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchSuppliers, createSupplier, createWithholding, extractInvoice } from '../lib/api';
import { calcLine, calcTotals, money, todayISO } from '../lib/calc';
import { useAuth } from '../context/AuthContext';

const EMPTY_LINE = {
  operation_date: '',
  invoice_number: '',
  control_number: '',
  debit_note: '',
  credit_note: '',
  transaction_type: '01-Reg.',
  affected_document: '',
  total_with_vat: '',
  exempt_amount: '',
  vat_rate: '16',
  retention_rate: '75',
};

export default function RetentionNew() {
  const navigate = useNavigate();
  const { business } = useAuth();
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [issueDate, setIssueDate] = useState(todayISO());
  const [lines, setLines] = useState([{ ...EMPTY_LINE, operation_date: todayISO() }]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // escaneo de factura con IA
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState(null);
  const [pendingSupplier, setPendingSupplier] = useState(null); // detectado pero no registrado

  useEffect(() => {
    fetchSuppliers().then(setSuppliers).catch((e) => setError(e.message));
  }, []);

  function setLine(i, field, value) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, [field]: value } : l)));
  }

  // La fecha de emisión es el default de la fecha de cada factura: al cambiarla
  // se actualizan las líneas que seguían con el default (no las editadas a mano).
  function onIssueDateChange(value) {
    setLines((prev) => prev.map((l) => (
      !l.operation_date || l.operation_date === issueDate ? { ...l, operation_date: value } : l
    )));
    setIssueDate(value);
  }

  // Formato oficial del Nº de control: 00-000000 (factura 390 → 00-000390)
  function controlFormat(value) {
    const digits = String(value).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    return digits ? `00-${digits.slice(-6).padStart(6, '0')}` : '';
  }

  function setInvoice(i, value) {
    setLines((prev) => prev.map((l, j) => (
      j === i ? { ...l, invoice_number: value, control_number: controlFormat(value) } : l
    )));
  }

  const totals = useMemo(() => calcTotals(lines), [lines]);

  const normalizeRif = (r) => String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  async function onScan(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setScanning(true);
    setError(null);
    setScanNote(null);
    setPendingSupplier(null);
    try {
      const x = await extractInvoice(file);
      setLines((prev) => prev.map((l, i) => (i === 0 ? {
        ...l,
        invoice_number: x.invoice_number || l.invoice_number,
        control_number: controlFormat(x.control_number || x.invoice_number) || l.control_number,
        operation_date: /^\d{4}-\d{2}-\d{2}$/.test(x.invoice_date || '') ? x.invoice_date : l.operation_date,
        total_with_vat: Number(x.total_with_vat) > 0 ? String(x.total_with_vat) : l.total_with_vat,
        exempt_amount: Number(x.exempt_amount) > 0 ? String(x.exempt_amount) : l.exempt_amount,
        vat_rate: ['8', '16', '31'].includes(String(Math.round(Number(x.vat_rate)))) ? String(Math.round(Number(x.vat_rate))) : l.vat_rate,
      } : l)));
      const rif = normalizeRif(x.supplier_rif);
      const match = rif && suppliers.find((s) => normalizeRif(s.rif) === rif);
      if (match) {
        setSupplierId(match.id);
        setScanNote(`Factura leída. Proveedor: ${match.name}. Revisa los datos antes de emitir.`);
      } else if (x.supplier_name && x.supplier_rif) {
        setPendingSupplier({ name: x.supplier_name, rif: x.supplier_rif.toUpperCase() });
      } else {
        setScanNote('Factura leída, pero no se pudo identificar el proveedor; selecciónalo manualmente.');
      }
    } catch (err) {
      setError(`No se pudo leer la factura: ${err.message}`);
    } finally {
      setScanning(false);
    }
  }

  async function onCreatePendingSupplier() {
    try {
      const created = await createSupplier(business.id, pendingSupplier);
      setSuppliers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSupplierId(created.id);
      setPendingSupplier(null);
      setScanNote(`Proveedor ${created.name} creado y seleccionado. Revisa los datos antes de emitir.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    const valid = lines.filter((l) => Number(l.total_with_vat) > 0);
    if (!supplierId) { setError('Selecciona el proveedor.'); return; }
    if (valid.length === 0) { setError('Registra al menos una factura con monto.'); return; }
    setBusy(true);
    try {
      const w = await createWithholding({
        supplierId,
        issueDate,
        lines: valid.map((l) => ({ ...l, operation_date: l.operation_date || issueDate })),
      });
      navigate(`/retentions/${w.id}`, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Nuevo comprobante</h1>
          <p className="page-sub">Retención de IVA a un proveedor.</p>
        </div>
        <div className="page-actions">
          <label className="btn primary">
            {scanning ? 'Leyendo factura…' : '📷 Escanear factura'}
            <input type="file" accept="image/*" hidden onChange={onScan} disabled={scanning} />
          </label>
          <Link to="/retentions" className="btn ghost">Cancelar</Link>
        </div>
      </header>

      {scanNote && <div className="form-ok">{scanNote}</div>}
      {pendingSupplier && (
        <div className="form-ok">
          La factura es de <strong>{pendingSupplier.name}</strong> ({pendingSupplier.rif}),
          que aún no está en tus proveedores.
          <div className="scan-actions">
            <button type="button" className="btn primary sm" onClick={onCreatePendingSupplier}>
              Crear y seleccionar
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setPendingSupplier(null)}>
              Ignorar
            </button>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="vform">
        <section className="card vsection">
          <h2>Datos generales</h2>
          <label>
            Proveedor
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">Selecciona un proveedor…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.rif}</option>
              ))}
            </select>
          </label>
          {suppliers.length === 0 && (
            <p className="hint">No tienes proveedores todavía. <Link to="/suppliers">Crea uno aquí</Link>.</p>
          )}
          <label>
            Fecha de emisión
            <input type="date" value={issueDate} onChange={(e) => onIssueDateChange(e.target.value)} required />
          </label>
        </section>

        {lines.map((l, i) => {
          const c = calcLine(l);
          return (
            <section className="card vsection" key={i}>
              <div className="vsection-head">
                <h2>Factura {lines.length > 1 ? i + 1 : ''}</h2>
                {lines.length > 1 && (
                  <button type="button" className="btn ghost sm" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>
                    Quitar
                  </button>
                )}
              </div>
              <div className="vgrid">
                <label>
                  Nº de factura
                  <input value={l.invoice_number} onChange={(e) => setInvoice(i, e.target.value)} placeholder="390" />
                </label>
                <label>
                  Nº de control
                  <input value={l.control_number} onChange={(e) => setLine(i, 'control_number', e.target.value)}
                    onBlur={(e) => setLine(i, 'control_number', controlFormat(e.target.value))} placeholder="00-000390" />
                </label>
              </div>
              <div className="vgrid">
                <label>
                  Total de la compra con IVA
                  <input type="number" step="0.01" min="0" value={l.total_with_vat}
                    onChange={(e) => setLine(i, 'total_with_vat', e.target.value)} placeholder="0,00" required={i === 0} />
                </label>
                <label>
                  Fecha de la factura
                  <input type="date" value={l.operation_date} onChange={(e) => setLine(i, 'operation_date', e.target.value)} />
                </label>
              </div>
              <details className="vmore">
                <summary>Configuración avanzada</summary>
                <div className="vgrid">
                  <label>
                    % Alícuota
                    <select value={l.vat_rate} onChange={(e) => setLine(i, 'vat_rate', e.target.value)}>
                      <option value="16">16% — general</option>
                      <option value="8">8% — reducida</option>
                      <option value="31">31% — lujo</option>
                    </select>
                  </label>
                  <label>
                    % Retención
                    <select value={l.retention_rate} onChange={(e) => setLine(i, 'retention_rate', e.target.value)}>
                      <option value="75">75%</option>
                      <option value="100">100%</option>
                    </select>
                  </label>
                </div>
                <label>
                  Monto exento
                  <input type="number" step="0.01" min="0" value={l.exempt_amount}
                    onChange={(e) => setLine(i, 'exempt_amount', e.target.value)} placeholder="0,00" />
                </label>
                <div className="vgrid">
                  <label>
                    Nº nota de débito
                    <input value={l.debit_note} onChange={(e) => setLine(i, 'debit_note', e.target.value)} />
                  </label>
                  <label>
                    Nº nota de crédito
                    <input value={l.credit_note} onChange={(e) => setLine(i, 'credit_note', e.target.value)} />
                  </label>
                </div>
                <div className="vgrid">
                  <label>
                    Tipo de transacción
                    <input value={l.transaction_type} onChange={(e) => setLine(i, 'transaction_type', e.target.value)} />
                  </label>
                  <label>
                    Nº doc. afectado
                    <input value={l.affected_document} onChange={(e) => setLine(i, 'affected_document', e.target.value)} />
                  </label>
                </div>
              </details>
              {Number(l.total_with_vat) > 0 && (
                <div className="line-calc">
                  Base {money(c.base)} · IVA {money(c.vat)} · <strong>Retenido {money(c.withheld)}</strong>
                </div>
              )}
            </section>
          );
        })}

        {lines.length < 5 && (
          <button type="button" className="btn ghost add-line" onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE, operation_date: issueDate }])}>
            + Agregar otra factura
          </button>
        )}

        <section className="card vsection totals">
          <h2>Resumen</h2>
          <div className="totals-row"><span>Total compras</span><span>{money(totals.totalPurchase)}</span></div>
          <div className="totals-row"><span>Total IVA retenido</span><span>{money(totals.totalWithheld)}</span></div>
          <div className="totals-row grand"><span>Total a pagar al proveedor</span><span>{money(totals.totalPayable)}</span></div>
        </section>

        {error && <div className="form-error">{error}</div>}
        <button className="btn primary lg block" disabled={busy}>
          {busy ? 'Emitiendo…' : 'Emitir comprobante'}
        </button>
      </form>
    </div>
  );
}
