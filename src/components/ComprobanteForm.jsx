import { useState } from 'react';
import { calcLinea, calcTotales, money, numeroComprobante, periodoDeFecha, formatFecha } from '../lib/calc';

const LINEA_VACIA = {
  fecha: '',
  nroFactura: '',
  nroControl: '',
  notaDebito: '',
  notaCredito: '',
  tipoTrans: '01-Reg.',
  docAfectado: '',
  totalConIva: '',
  exento: '',
  alicuota: 16,
  pctRetencion: 75,
};

export default function ComprobanteForm({ empresa, proveedores, onEmitir }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [proveedorId, setProveedorId] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [lineas, setLineas] = useState([{ ...LINEA_VACIA, fecha: hoy }]);

  const periodo = periodoDeFecha(fecha);
  const numero = numeroComprobante(periodo, empresa.nextSeq);
  const totales = calcTotales(lineas);
  const proveedor = proveedores.find((p) => p.id === proveedorId);

  const setLinea = (i, campo, valor) => {
    setLineas((prev) => prev.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  };

  // El Nº de control se completa solo a partir del Nº de factura (formato del sheet: 00-XXXXXX)
  const setFactura = (i, valor) => {
    setLineas((prev) => prev.map((l, j) =>
      j === i ? { ...l, nroFactura: valor, nroControl: valor ? `00-${valor}` : '' } : l
    ));
  };

  const emitir = () => {
    if (!proveedor) {
      alert('Selecciona un proveedor (sujeto retenido).');
      return;
    }
    const validas = lineas.filter((l) => Number(l.totalConIva) > 0);
    if (validas.length === 0) {
      alert('Ingresa al menos una factura con su total.');
      return;
    }
    onEmitir({
      id: crypto.randomUUID(),
      numero,
      periodo,
      fecha: formatFecha(fecha),
      proveedorId: proveedor.id,
      proveedorNombre: proveedor.nombre,
      proveedorRif: proveedor.rif,
      lineas: validas.map((l) => ({ ...l, fecha: formatFecha(l.fecha) })),
      createdAt: new Date().toISOString(),
    });
    setLineas([{ ...LINEA_VACIA, fecha: hoy }]);
    setProveedorId('');
  };

  return (
    <div className="panel">
      <h2>Nuevo comprobante</h2>

      <div className="form-row">
        <label>
          Nro. de comprobante
          <input value={numero} readOnly className="readonly" />
        </label>
        <label>
          Fecha de emisión
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <label>
          Sujeto retenido (proveedor)
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">— Seleccionar —</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre} ({p.rif})</option>
            ))}
          </select>
        </label>
      </div>

      <h3>Facturas (máx. 5)</h3>
      {lineas.map((l, i) => {
        const { base, iva, retenido } = calcLinea(l);
        return (
          <fieldset key={i} className="linea">
            <legend>Operación {i + 1}</legend>
            <div className="form-row">
              <label>Fecha factura
                <input type="date" value={l.fecha} onChange={(e) => setLinea(i, 'fecha', e.target.value)} />
              </label>
              <label>Nº de factura
                <input value={l.nroFactura} onChange={(e) => setFactura(i, e.target.value)} placeholder="000261" />
              </label>
              <label>Nº de control (automático)
                <input value={l.nroControl} readOnly className="readonly" />
              </label>
              <label>Total compra con IVA
                <input type="number" step="0.01" min="0" value={l.totalConIva}
                  onChange={(e) => setLinea(i, 'totalConIva', e.target.value)} placeholder="0,00" />
              </label>
            </div>
            <div className="calculado">
              Base imponible: <strong>{money(base)}</strong> · Impuesto IVA: <strong>{money(iva)}</strong> ·
              IVA retenido: <strong>{money(retenido)}</strong>
            </div>
          </fieldset>
        );
      })}

      <div className="acciones">
        {lineas.length < 5 && (
          <button type="button" className="secundario"
            onClick={() => setLineas((prev) => [...prev, { ...LINEA_VACIA, fecha: hoy }])}>
            + Agregar factura
          </button>
        )}
        {lineas.length > 1 && (
          <button type="button" className="secundario"
            onClick={() => setLineas((prev) => prev.slice(0, -1))}>
            − Quitar última
          </button>
        )}
      </div>

      <div className="totales">
        <div>Total compra con IVA: <strong>{money(totales.totalCompra)}</strong></div>
        <div>Total IVA retenido: <strong>{money(totales.totalRetenido)}</strong></div>
        <div>Total a pagar: <strong>{money(totales.totalAPagar)}</strong></div>
      </div>

      <button type="button" className="primario" onClick={emitir}>
        Emitir comprobante
      </button>
    </div>
  );
}
