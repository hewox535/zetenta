import { useState } from 'react';
import { useStored, DEFAULT_EMPRESA } from './lib/storage';
import ComprobanteForm from './components/ComprobanteForm';
import ComprobantePrint from './components/ComprobantePrint';
import Proveedores from './components/Proveedores';
import Empresa from './components/Empresa';
import Historial from './components/Historial';

const TABS = [
  ['nuevo', 'Nuevo comprobante'],
  ['historial', 'Historial'],
  ['proveedores', 'Proveedores'],
  ['empresa', 'Empresa'],
];

export default function App() {
  const [empresa, setEmpresa] = useStored('empresa', DEFAULT_EMPRESA);
  const [proveedores, setProveedores] = useStored('proveedores', []);
  const [comprobantes, setComprobantes] = useStored('comprobantes', []);
  const [tab, setTab] = useState('nuevo');
  const [vista, setVista] = useState(null); // comprobante en vista previa / impresión

  const emitir = (comprobante) => {
    setComprobantes((prev) => [...prev, comprobante]);
    setEmpresa((prev) => ({ ...prev, nextSeq: prev.nextSeq + 1 }));
    setVista(comprobante);
  };

  if (vista) {
    return (
      <div className="app">
        <div className="barra-vista no-print">
          <button type="button" className="secundario" onClick={() => setVista(null)}>← Volver</button>
          <button type="button" className="primario" onClick={() => window.print()}>
            Imprimir / Guardar PDF
          </button>
        </div>
        <ComprobantePrint empresa={empresa} comprobante={vista} />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="no-print">
        <h1>Comprobantes de Retención de IVA</h1>
        <nav>
          {TABS.map(([id, label]) => (
            <button key={id} type="button"
              className={tab === id ? 'tab activa' : 'tab'}
              onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'nuevo' && (
        <ComprobanteForm empresa={empresa} proveedores={proveedores} onEmitir={emitir} />
      )}
      {tab === 'historial' && (
        <Historial
          comprobantes={comprobantes}
          onVer={setVista}
          onEliminar={(id) => setComprobantes((prev) => prev.filter((c) => c.id !== id))}
        />
      )}
      {tab === 'proveedores' && (
        <Proveedores proveedores={proveedores} setProveedores={setProveedores} />
      )}
      {tab === 'empresa' && <Empresa empresa={empresa} setEmpresa={setEmpresa} />}
    </div>
  );
}
