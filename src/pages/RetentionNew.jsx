import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  fetchSuppliers, createSupplier, createWithholding, updateWithholding,
  fetchWithholding, extractInvoice, setWithholdingStamped,
} from '../lib/api';
import { calcLine, calcTotals, money, todayISO } from '../lib/calc';
import { useAuth } from '../context/AuthContext';

const MAX_LINES = 5;

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

// Clave estable por factura para que React no mezcle su estado al reordenarlas.
let nextKey = 0;
const withKey = (l) => ({ ...l, key: `l${nextKey++}` });
const blankLine = (date) => withKey({ ...EMPTY_LINE, operation_date: date });

// Convierte una línea guardada (números y decimales) al formato del formulario.
function lineToForm(l) {
  return withKey({
    operation_date: l.operation_date || '',
    invoice_number: l.invoice_number || '',
    control_number: l.control_number || '',
    debit_note: l.debit_note || '',
    credit_note: l.credit_note || '',
    transaction_type: l.transaction_type || '01-Reg.',
    affected_document: l.affected_document || '',
    total_with_vat: Number(l.total_with_vat) ? String(Number(l.total_with_vat)) : '',
    exempt_amount: Number(l.exempt_amount) ? String(Number(l.exempt_amount)) : '',
    vat_rate: String(Number(l.vat_rate) || 16),
    retention_rate: String(Number(l.retention_rate) || 75),
  });
}

export default function RetentionNew() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { business, refreshBusiness } = useAuth();
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [issueDate, setIssueDate] = useState(todayISO());
  const [lines, setLines] = useState(() => [blankLine(todayISO())]);
  const [number, setNumber] = useState(null); // Nº del comprobante en edición
  const [seq, setSeq] = useState(''); // correlativo editable (solo edición)
  const [stamped, setStamped] = useState(false); // si este comprobante lleva el sello
  const [loaded, setLoaded] = useState(!isEdit);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // escaneo de factura con IA
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState(null);
  const [pendingSupplier, setPendingSupplier] = useState(null); // detectado pero no registrado

  useEffect(() => {
    fetchSuppliers().then(setSuppliers).catch((e) => setError(e.message));
  }, []);

  // Modo edición: carga el comprobante existente y precarga el formulario.
  useEffect(() => {
    if (!isEdit) return;
    fetchWithholding(id).then((w) => {
      setSupplierId(w.supplier_id || '');
      setIssueDate(w.issue_date || todayISO());
      setNumber(w.number);
      setSeq(String(Number(w.number.slice(-8))));
      setStamped(!!w.stamped);
      const rows = (w.withholding_lines || []).slice().sort((a, b) => a.line_number - b.line_number);
      setLines(rows.length ? rows.map(lineToForm) : [blankLine(w.issue_date)]);
      setLoaded(true);
    }).catch((e) => { setError(e.message); setLoaded(true); });
  }, [id, isEdit]);

  function setLine(i, field, value) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, [field]: value } : l)));
  }

  // Mueve una factura una posición arriba (-1) o abajo (+1); el orden de la
  // lista es el orden en que salen en el comprobante.
  function moveLine(i, dir) {
    setLines((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
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

  // Una factura "vacía" es la que aún no tiene ni número ni monto: ahí cae el
  // siguiente escaneo; si todas tienen datos, se agrega una nueva.
  const isBlank = (l) => !l.invoice_number && !(Number(l.total_with_vat) > 0);

  // Datos leídos de la factura sobre una línea del formulario.
  function applyExtract(l, x) {
    return {
      ...l,
      invoice_number: x.invoice_number || l.invoice_number,
      control_number: controlFormat(x.control_number || x.invoice_number) || l.control_number,
      operation_date: /^\d{4}-\d{2}-\d{2}$/.test(x.invoice_date || '') ? x.invoice_date : l.operation_date,
      total_with_vat: Number(x.total_with_vat) > 0 ? String(x.total_with_vat) : l.total_with_vat,
      exempt_amount: Number(x.exempt_amount) > 0 ? String(x.exempt_amount) : l.exempt_amount,
      vat_rate: ['8', '16', '31'].includes(String(Math.round(Number(x.vat_rate)))) ? String(Math.round(Number(x.vat_rate))) : l.vat_rate,
    };
  }

  // Escanea una o varias fotos: cada factura leída se suma a la misma
  // retención (en la primera línea libre, o en una nueva hasta el máximo).
  async function onScan(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setScanning(true);
    setError(null);
    setScanNote(null);
    setPendingSupplier(null);

    const notes = [];
    const problems = [];
    let current = lines;        // espejo local para decidir sin esperar al render
    let currentSupplier = supplierId;
    let pending = null;
    let added = 0;

    for (const [n, file] of files.entries()) {
      const label = files.length > 1 ? `Foto ${n + 1}: ` : '';
      setScanNote(files.length > 1 ? `Leyendo factura ${n + 1} de ${files.length}…` : null);
      try {
        const x = await extractInvoice(file);
        const invoice = String(x.invoice_number || '').trim();
        if (invoice && current.some((l) => l.invoice_number.trim() === invoice)) {
          problems.push(`${label}la factura Nº ${invoice} ya estaba en este comprobante.`);
          continue;
        }
        let idx = current.findIndex(isBlank);
        if (idx === -1) {
          if (current.length >= MAX_LINES) {
            problems.push(`${label}un comprobante admite máximo ${MAX_LINES} facturas; esta no se agregó.`);
            continue;
          }
          current = [...current, blankLine(issueDate)];
          idx = current.length - 1;
        }
        current = current.map((l, i) => (i === idx ? applyExtract(l, x) : l));
        setLines(current);
        added += 1;

        // Proveedor: el de la primera factura lo fija; las siguientes deben coincidir.
        const rif = normalizeRif(x.supplier_rif);
        const match = rif && suppliers.find((sp) => normalizeRif(sp.rif) === rif);
        if (match && !currentSupplier) {
          currentSupplier = match.id;
          setSupplierId(match.id);
          notes.push(`Proveedor: ${match.name}.`);
        } else if (match && match.id !== currentSupplier) {
          problems.push(`${label}la factura Nº ${invoice || 's/n'} es de ${match.name}, distinto al proveedor del comprobante. Revísala.`);
        } else if (!match && x.supplier_name && x.supplier_rif && !currentSupplier && !pending) {
          pending = { name: x.supplier_name, rif: x.supplier_rif.toUpperCase() };
        }
      } catch (err) {
        problems.push(`${label}no se pudo leer la factura: ${err.message}`);
      }
    }

    if (pending) setPendingSupplier(pending);
    if (added) {
      const base = added > 1 ? `${added} facturas leídas.` : 'Factura leída.';
      const noSupplier = !currentSupplier && !pending ? ' No se pudo identificar el proveedor; selecciónalo manualmente.' : '';
      setScanNote(`${base} ${notes.join(' ')}${noSupplier} Revisa los datos antes de emitir.`.replace(/\s+/g, ' '));
    } else {
      setScanNote(null);
    }
    if (problems.length) setError(problems.join(' '));
    setScanning(false);
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
    const seqNum = Number(seq);
    if (isEdit && (!Number.isInteger(seqNum) || seqNum < 1)) {
      setError('El correlativo debe ser un número entero mayor que cero.'); return;
    }
    setBusy(true);
    const payloadLines = valid.map(({ key, ...l }) => ({ ...l, operation_date: l.operation_date || issueDate }));
    try {
      if (isEdit) {
        await updateWithholding({ id, supplierId, issueDate, lines: payloadLines, seq: seqNum });
        await setWithholdingStamped(id, stamped);
        navigate(`/retentions/${id}`, { replace: true });
      } else {
        const w = await createWithholding({ supplierId, issueDate, lines: payloadLines });
        // El sello va por su propia función: es presentación, no contenido fiscal.
        if (stamped) await setWithholdingStamped(w.id, true);
        // Mantiene el correlativo de Ajustes al día tras consumir un número.
        refreshBusiness().catch(() => {});
        navigate(`/retentions/${w.id}`, { replace: true });
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (isEdit && !loaded) {
    return <div className="page narrow"><div className="empty">Cargando…</div></div>;
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>{isEdit ? 'Editar comprobante' : 'Nuevo comprobante'}</h1>
          <p className="page-sub">
            {isEdit
              ? `Corrige los datos del comprobante Nº ${number}, incluido su correlativo.`
              : 'Retención de IVA a un proveedor.'}
          </p>
        </div>
        <div className="page-actions">
          {lines.length < MAX_LINES || lines.some(isBlank) ? (
            <label className="btn primary" title="Puedes elegir varias fotos a la vez; cada factura se suma al comprobante">
              {scanning ? 'Leyendo factura…' : (lines.some((l) => !isBlank(l)) ? '📷 Escanear otra factura' : '📷 Escanear factura')}
              <input type="file" accept="image/*" multiple hidden onChange={onScan} disabled={scanning} />
            </label>
          ) : null}
          <Link to={isEdit ? `/retentions/${id}` : '/retentions'} className="btn ghost">Cancelar</Link>
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
          {business?.stamp_url ? (
            <label className="sello-check">
              <input type="checkbox" checked={stamped} onChange={(e) => setStamped(e.target.checked)} />
              <span className="sello-check-text">
                Imprimir con el sello de la empresa
                <span className="hint">Aparece en la esquina inferior derecha del comprobante.</span>
              </span>
              <img className="sello-mini" src={business.stamp_url} alt="" />
            </label>
          ) : (
            <p className="hint">
              Para sellar un comprobante, carga primero el sello de la empresa en{' '}
              <Link to="/settings">Negocio → Retenciones</Link>.
            </p>
          )}
          {isEdit && (
            <label>
              Correlativo (Nº de comprobante)
              <input type="number" min="1" max="99999999" step="1" value={seq}
                onChange={(e) => setSeq(e.target.value)} required />
              <span className="hint">
                Solo el número correlativo; el período se toma de la fecha. No puede coincidir
                con el de otro comprobante.
              </span>
            </label>
          )}
        </section>

        {lines.map((l, i) => {
          const c = calcLine(l);
          return (
            <section className="card vsection" key={l.key}>
              <div className="vsection-head">
                <h2>Factura {lines.length > 1 ? i + 1 : ''}</h2>
                {lines.length > 1 && (
                  <div className="line-actions">
                    <button type="button" className="btn ghost sm" onClick={() => moveLine(i, -1)}
                      disabled={i === 0} title="Mover antes" aria-label="Mover factura antes">↑</button>
                    <button type="button" className="btn ghost sm" onClick={() => moveLine(i, 1)}
                      disabled={i === lines.length - 1} title="Mover después" aria-label="Mover factura después">↓</button>
                    <button type="button" className="btn ghost sm" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>
                      Quitar
                    </button>
                  </div>
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

        {lines.length < MAX_LINES && (
          <button type="button" className="btn ghost add-line" onClick={() => setLines((prev) => [...prev, blankLine(issueDate)])}>
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
          {busy
            ? (isEdit ? 'Guardando…' : 'Emitiendo…')
            : (isEdit ? 'Guardar cambios' : 'Emitir comprobante')}
        </button>
      </form>
    </div>
  );
}
