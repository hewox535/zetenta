import { useState, useEffect, useCallback } from 'react';
import {
  fetchEmpresa,
  saveEmpresa,
  fetchProveedores,
  insertProveedor,
  deleteProveedor,
  fetchComprobantes,
  insertComprobante,
  deleteComprobante,
} from './lib/db';
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
  const [empresa, setEmpresa] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [comprobantes, setComprobantes] = useState([]);
  const [tab, setTab] = useState('nuevo');
  const [vista, setVista] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const [emp, provs, comps] = await Promise.all([
          fetchEmpresa(),
          fetchProveedores(),
          fetchComprobantes(),
        ]);
        if (!activo) return;
        setEmpresa(emp);
        setProveedores(provs);
        setComprobantes(comps);
      } catch (e) {
        if (activo) setErrorCarga(e.message || String(e));
      } finally {
        if (activo) setCargando(false);
      }
    })();
    return () => { activo = false; };
  }, []);

  // Empresa: guarda en blur/explícito, no en cada tecla.
  const actualizarEmpresa = useCallback(async (next) => {
    const prev = empresa;
    setEmpresa(next);
    try {
      await saveEmpresa(next);
    } catch (e) {
      setEmpresa(prev);
      alert('No se pudo guardar la empresa: ' + (e.message || e));
    }
  }, [empresa]);

  const emitir = useCallback(async (comprobante) => {
    const prevComps = comprobantes;
    const prevEmp = empresa;
    const nuevoComprobante = { ...comprobante };
    setComprobantes((prev) => [...prev, nuevoComprobante]);
    setEmpresa((prev) => ({ ...prev, nextSeq: prev.nextSeq + 1 }));
    setVista(nuevoComprobante);
    try {
      const guardado = await insertComprobante(nuevoComprobante);
      setComprobantes((prev) => prev.map((c) => (c.id === nuevoComprobante.id ? guardado : c)));
      await saveEmpresa({ ...empresa, nextSeq: empresa.nextSeq + 1 });
    } catch (e) {
      setComprobantes(prevComps);
      setEmpresa(prevEmp);
      setVista(null);
      alert('No se pudo emitir el comprobante: ' + (e.message || e));
    }
  }, [comprobantes, empresa]);

  const eliminarComprobante = useCallback(async (id) => {
    const prev = comprobantes;
    setComprobantes((prev) => prev.filter((c) => c.id !== id));
    try {
      await deleteComprobante(id);
    } catch (e) {
      setComprobantes(prev);
      alert('No se pudo eliminar el comprobante: ' + (e.message || e));
    }
  }, [comprobantes]);

  const agregarProveedor = useCallback(async ({ nombre, rif }) => {
    const guardado = await insertProveedor({ nombre, rif });
    setProveedores((prev) => [...prev, guardado]);
    return guardado;
  }, []);

  const eliminarProveedor = useCallback(async (id) => {
    const prev = proveedores;
    setProveedores((prev) => prev.filter((p) => p.id !== id));
    try {
      await deleteProveedor(id);
    } catch (e) {
      setProveedores(prev);
      alert('No se pudo eliminar el proveedor: ' + (e.message || e));
    }
  }, [proveedores]);

  if (cargando) {
    return <div className="app"><p className="vacio">Cargando…</p></div>;
  }
  if (errorCarga) {
    return (
      <div className="app">
        <p className="vacio">No se pudo cargar la base de datos: {errorCarga}</p>
      </div>
    );
  }
  if (!empresa) {
    return <div className="app"><p className="vacio">Sin datos de empresa.</p></div>;
  }

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
          onEliminar={eliminarComprobante}
        />
      )}
      {tab === 'proveedores' && (
        <Proveedores
          proveedores={proveedores}
          onAgregar={agregarProveedor}
          onEliminar={eliminarProveedor}
        />
      )}
      {tab === 'empresa' && <Empresa empresa={empresa} onGuardar={actualizarEmpresa} />}
    </div>
  );
}
