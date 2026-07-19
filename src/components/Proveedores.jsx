import { useState } from 'react';

export default function Proveedores({ proveedores, setProveedores }) {
  const [nombre, setNombre] = useState('');
  const [rif, setRif] = useState('');

  const agregar = () => {
    if (!nombre.trim() || !rif.trim()) {
      alert('Nombre y RIF son obligatorios.');
      return;
    }
    setProveedores((prev) => [...prev, { id: crypto.randomUUID(), nombre: nombre.trim(), rif: rif.trim().toUpperCase() }]);
    setNombre('');
    setRif('');
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
        <button type="button" className="primario" onClick={agregar}>Agregar</button>
      </div>

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
                      if (confirm(`¿Eliminar a ${p.nombre}?`)) {
                        setProveedores((prev) => prev.filter((x) => x.id !== p.id));
                      }
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
