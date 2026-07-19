import { useState } from 'react';

export default function Proveedores({ proveedores, onAgregar, onEliminar }) {
  const [nombre, setNombre] = useState('');
  const [rif, setRif] = useState('');
  const [agregando, setAgregando] = useState(false);
  const [error, setError] = useState(null);

  const agregar = async () => {
    setError(null);
    if (!nombre.trim() || !rif.trim()) {
      setError('Nombre y RIF son obligatorios.');
      return;
    }
    setAgregando(true);
    try {
      await onAgregar({ nombre: nombre.trim(), rif: rif.trim().toUpperCase() });
      setNombre('');
      setRif('');
    } catch (e) {
      setError('No se pudo agregar el proveedor: ' + (e.message || e));
    } finally {
      setAgregando(false);
    }
  };

  return (
    <div className="panel">
      <h2>Proveedores (sujetos retenidos)</h2>
      <div className="form-row">
        <label>Nombre o razón social
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Vipego Inversiones CA" />
        </label>
        <label>RIF
          <input value={rif} onChange={(e) => setRif(e.target.value)} placeholder="J-402826257" />
        </label>
        <button type="button" className="primario" onClick={agregar} disabled={agregando}>
          {agregando ? 'Agregando…' : 'Agregar'}
        </button>
      </div>
      {error && <p className="vacio">{error}</p>}
      {proveedores.length === 0 ? (
        <p className="vacio">No hay proveedores guardados todavía.</p>
      ) : (
        <table className="lista">
          <thead>
            <tr><th>Nombre</th><th>RIF</th><th></th></tr>
          </thead>
          <tbody>
            {proveedores.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td>{p.rif}</td>
                <td>
                  <button type="button" className="peligro"
                    onClick={() => {
                      if (confirm(`¿Eliminar a ${p.nombre}?`)) onEliminar(p.id);
                    }}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
