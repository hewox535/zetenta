import { useState } from 'react';

export default function Empresa({ empresa, onGuardar }) {
  const [local, setLocal] = useState(empresa);
  const [guardando, setGuardando] = useState(false);

  const set = (campo) => (e) =>
    setLocal((prev) => ({
      ...prev,
      [campo]: campo === 'nextSeq' ? Number(e.target.value) || 1 : e.target.value,
    }));

  const guardar = async () => {
    setGuardando(true);
    try {
      await onGuardar(local);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="panel">
      <h2>Datos del agente de retención</h2>
      <div className="form-col">
        <label>Nombre o razón social
          <input value={local.nombre} onChange={set('nombre')} />
        </label>
        <label>RIF
          <input value={local.rif} onChange={set('rif')} />
        </label>
        <label>Dirección fiscal
          <input value={local.direccion} onChange={set('direccion')} />
        </label>
        <label>Próximo correlativo (secuencial del Nro. de comprobante)
          <input type="number" min="1" value={local.nextSeq} onChange={set('nextSeq')} />
        </label>
      </div>
      <p className="nota">
        El número de comprobante se genera como AÑO+MES+secuencial de 8 dígitos
        (ej. 202607{String(local.nextSeq).padStart(8, '0')}) y el secuencial avanza
        automáticamente con cada comprobante emitido.
      </p>
      <button type="button" className="primario" onClick={guardar} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </div>
  );
}
