export default function Empresa({ empresa, setEmpresa }) {
  const set = (campo) => (e) =>
    setEmpresa((prev) => ({ ...prev, [campo]: campo === 'nextSeq' ? Number(e.target.value) || 1 : e.target.value }));

  return (
    <div className="panel">
      <h2>Datos del agente de retención</h2>
      <div className="form-col">
        <label>Nombre o razón social
          <input value={empresa.nombre} onChange={set('nombre')} />
        </label>
        <label>RIF
          <input value={empresa.rif} onChange={set('rif')} />
        </label>
        <label>Dirección fiscal
          <input value={empresa.direccion} onChange={set('direccion')} />
        </label>
        <label>Próximo correlativo (secuencial del Nro. de comprobante)
          <input type="number" min="1" value={empresa.nextSeq} onChange={set('nextSeq')} />
        </label>
      </div>
      <p className="nota">
        El número de comprobante se genera como AÑO+MES+secuencial de 8 dígitos
        (ej. 202607{String(empresa.nextSeq).padStart(8, '0')}) y el secuencial avanza
        automáticamente con cada comprobante emitido.
      </p>
    </div>
  );
}
