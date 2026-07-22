import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchWithholding } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import WithholdingPrint from '../components/WithholdingPrint';

export default function RetentionView() {
  const { id } = useParams();
  const { business } = useAuth();
  const [withholding, setWithholding] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchWithholding(id).then(setWithholding).catch((e) => setError(e.message));
  }, [id]);

  // El título del documento es el nombre con el que se guarda el PDF:
  // "{correlativo} {proveedor} {fecha de emisión}", p. ej. "137 Inversiones XYZ 15-07-2026".
  useEffect(() => {
    if (!withholding) return;
    const prev = document.title;
    const seq = String(Number(withholding.number.slice(-8)));
    const date = (withholding.issue_date || '').split('-').reverse().join('-');
    document.title = `${seq} ${withholding.supplier_name} ${date}`;
    return () => { document.title = prev; };
  }, [withholding]);

  if (error) return <div className="page"><div className="form-error">{error}</div></div>;
  if (!withholding || !business) return <div className="page"><div className="empty">Cargando…</div></div>;

  return (
    <div className="page">
      <header className="page-head no-print">
        <div>
          <h1>Comprobante {withholding.number}</h1>
          <p className="page-sub">Vista previa idéntica al formato oficial. Imprime o guarda como PDF.</p>
        </div>
        <div className="page-actions">
          <Link to="/retentions" className="btn ghost">Volver</Link>
          <button className="btn primary" onClick={() => window.print()}>Imprimir</button>
        </div>
      </header>
      <WithholdingPrint business={business} withholding={withholding} />
    </div>
  );
}
