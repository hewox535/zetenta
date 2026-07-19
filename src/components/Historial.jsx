import { calcTotales, money } from '../lib/calc';

export default function Historial({ comprobantes, onVer, onEliminar }) {
  return (
    <div className="panel">
      <h2>Historial de comprobantes</h2>
      {comprobantes.length === 0 ? (
        <p className="vacio">Aún no has emitido comprobantes.</p>
      ) : (
        <table className="lista">
          <thead>
            <tr>
              <th>Nro. comprobante</th>
              <th>Fecha</th>
              <th>Sujeto retenido</th>
              <th>IVA retenido</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...comprobantes].reverse().map((c) => (
              <tr key={c.id}>
                <td>{c.numero}</td>
                <td>{c.fecha}</td>
                <td>{c.proveedorNombre}</td>
                <td className="num">{money(calcTotales(c.lineas).totalRetenido)}</td>
                <td>
                  <button type="button" className="secundario" onClick={() => onVer(c)}>Ver / PDF</button>{' '}
                  <button type="button" className="peligro"
                    onClick={() => {
                      if (confirm(`¿Eliminar el comprobante ${c.numero}?`)) onEliminar(c.id);
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
