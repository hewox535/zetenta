import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { createBranch } from '../lib/api';
import { FinModal } from './FinUI';
import '../pages/finance.css';

export const STORE = (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M3 10l1.6-5.2A1 1 0 0 1 5.6 4h12.8a1 1 0 0 1 1 .8L21 10a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M10 20v-5h4v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
);
const CHEVRON = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const CHECK = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const PLUS = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;

const initials = (name = '') => name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·';

// Selector de la sucursal en la que se trabaja (solo si el usuario ve más de
// una). Se abre como una lista; el administrador también puede crear una nueva
// desde aquí. compact: versión de la barra superior en el celular.
export default function BranchPicker({ compact = false, onPicked }) {
  const { business, isBusinessAdmin } = useAuth();
  const { branches, branchId, setBranchId, currentBranch, reload } = useBranch();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(null);   // { name, address, busy, error }
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (!branches || branches.length < 2) return null;

  const pick = (id) => { setBranchId(id); setOpen(false); onPicked?.(); };

  async function onCreate(e) {
    e.preventDefault();
    const name = creating.name.trim();
    if (!name) return;
    setCreating((c) => ({ ...c, busy: true, error: null }));
    try {
      const b = await createBranch(business.id, { name, address: creating.address.trim(), sortOrder: branches.length });
      await reload();
      setBranchId(b.id);
      setCreating(null);
      onPicked?.();
    } catch (err) {
      setCreating((c) => ({ ...c, busy: false, error: err.message }));
    }
  }

  return (
    <div className={`branch-pick${compact ? ' compact' : ''}${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="branch-pick-btn" aria-haspopup="listbox" aria-expanded={open}
        title={`Sucursal: ${currentBranch?.name || ''}`} onClick={() => setOpen((o) => !o)}>
        {/* Con el menú contraído solo caben las iniciales (p. ej. "AP"). */}
        <span className="branch-pick-initials" aria-hidden="true">{initials(currentBranch?.name)}</span>
        <span className="branch-pick-text">
          {!compact && <span className="branch-pick-label">Sucursal</span>}
          <span className="branch-pick-name">{currentBranch?.name || 'Elegir sucursal'}</span>
        </span>
        <span className="branch-pick-chev">{CHEVRON}</span>
      </button>

      {open && (
        <div className="branch-pick-menu" role="listbox" aria-label="Sucursales">
          <div className="branch-pick-head">Trabajar en</div>
          {branches.map((b) => (
            <button key={b.id} type="button" role="option" aria-selected={b.id === branchId}
              className={`branch-pick-opt${b.id === branchId ? ' on' : ''}`} onClick={() => pick(b.id)}>
              <span className="branch-pick-opt-text">
                <span>{b.name}</span>
                {b.address && <small>{b.address}</small>}
              </span>
              {b.id === branchId && <span className="branch-pick-check">{CHECK}</span>}
            </button>
          ))}
          {isBusinessAdmin && (
            <>
              <div className="branch-pick-sep" />
              <button type="button" className="branch-pick-new"
                onClick={() => { setOpen(false); setCreating({ name: '', address: '', busy: false, error: null }); }}>
                <span className="branch-pick-new-icon">{PLUS}</span>
                Nueva sucursal
              </button>
            </>
          )}
        </div>
      )}

      {/* Al body: el menú lateral usa backdrop-filter y encerraría al modal. */}
      {creating && createPortal(
        <FinModal title="Nueva sucursal" sub="Tendrá su propio stock, su caja y sus ventas." busy={creating.busy}
          onClose={() => setCreating(null)} onSubmit={onCreate}
          footer={(
            <>
              <button type="button" className="btn ghost" disabled={creating.busy} onClick={() => setCreating(null)}>Cancelar</button>
              <button className="btn primary" disabled={creating.busy || !creating.name.trim()}>
                {creating.busy ? 'Creando…' : 'Crear y usar'}
              </button>
            </>
          )}>
          <label className="fm-field">Nombre
            <input autoFocus value={creating.name} placeholder="Sucursal Centro" maxLength={60}
              onChange={(e) => setCreating((c) => ({ ...c, name: e.target.value }))} />
          </label>
          <label className="fm-field"><span>Dirección <span className="muted">(opcional)</span></span>
            <input value={creating.address} placeholder="C.C. Plaza Mayor, local 12"
              onChange={(e) => setCreating((c) => ({ ...c, address: e.target.value }))} />
          </label>
          <p className="muted branch-pick-hint">
            Quien tenga acceso a todas las sucursales la verá de inmediato. Para limitar a alguien a ciertas
            sucursales, ve a Negocio → Sucursales.
          </p>
          {creating.error && <div className="form-error">{creating.error}</div>}
        </FinModal>,
        document.body,
      )}
    </div>
  );
}
