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

  // El navegador imprime el título del documento en el encabezado de la hoja;
  // aquí evitamos que salga "Zetenta" y de paso el PDF se guarda con buen nombre.
  useEffect(() => {
    if (!withholding) return;
    const prev = document.title;
    document.title = `Comprobante ${withholding.number}`;
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
