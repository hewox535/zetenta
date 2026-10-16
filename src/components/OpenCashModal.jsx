import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBankAccounts, openCashSession } from '../lib/api';

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(',', '.')));

// Modal de apertura de caja, compartido por el módulo Caja y por Ventas (para
// abrirla sin salir de la venta). Carga solo las cuentas de efectivo.
export default function OpenCashModal({ branchId, onClose, onOpened }) {
  const [accounts, setAccounts] = useState([]);
  const [amounts, setAmounts] = useState({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchBankAccounts()
      .then((a) => setAccounts(a.filter((x) => x.active && x.is_cash)))
      .catch((e) => setError(e.message));
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await openCashSession(branchId,
        accounts.map((a) => ({ account_id: a.id, amount: num(amounts[a.id]) || 0 })), note);
      await onOpened();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Abrir caja</h2>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={onClose}>Cerrar</button>
        </div>
        <p className="hint">
          Cuenta lo que hay ahora mismo en la caja: es el fondo con el que arranca el día.
          Déjalo en cero si empiezas sin efectivo.
        </p>
        <form onSubmit={onSubmit} className="vform">
          {accounts.length === 0 ? (
            <p className="hint">
              Ninguna cuenta está marcada como efectivo; la caja se abre sin fondo.
              Puedes marcarlas en <Link to="/settings">Negocio → Cuentas</Link>.
            </p>
          ) : accounts.map((a) => (
            <label key={a.id}>
              <span>{a.name} <span className="muted">en {a.currency === 'USD' ? 'dólares' : 'bolívares'}</span></span>
              <input inputMode="decimal" placeholder="0" value={amounts[a.id] ?? ''}
                onChange={(e) => setAmounts((o) => ({ ...o, [a.id]: e.target.value }))} />
            </label>
          ))}
          <label>Nota (opcional)
            <input value={note} placeholder="Turno de la mañana…" onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <div className="form-error">{error}</div>}
          <div className="inline-form-actions">
            <button className="btn primary" disabled={busy}>{busy ? 'Abriendo…' : 'Abrir caja'}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Volver</button>
          </div>
        </form>
      </div>
    </div>
  );
}
