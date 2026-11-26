import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { createBranch, updateBranch } from '../lib/api';
import { FinModal } from './FinUI';
import '../pages/finance.css';

export const STORE = (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M3 10l1.6-5.2A1 1 0 0 1 5.6 4h12.8a1 1 0 0 1 1 .8L21 10a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M10 20v-5h4v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
);
const CHEVRON = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const CHECK = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const PENCIL = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.7"/></svg>;
const PLUS = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;

const initials = (name = '') => name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·';

// Selector de la sucursal en la que se trabaja (solo si el usuario ve más de
// una). Se abre como una lista; el administrador también puede crear una nueva
// desde aquí. compact: versión de la barra superior en el celular.
export default function BranchPicker({ compact = false, onPicked }) {
  const { business, isBusinessAdmin } = useAuth();
  const { branches, allBranches, branchId, setBranchId, currentBranch, reload } = useBranch();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(null);   // { name, address, busy, error }
  const [editing, setEditing] = useState(null);     // { names: { id: nombre }, busy, error }
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

  // Renombrar sucursales (solo administradores; el servidor también lo exige).
  const editList = allBranches?.length ? allBranches : branches;
  const changed = editing ? editList.filter((b) => (editing.names[b.id] ?? b.name).trim() !== b.name) : [];
  const emptyName = editing ? editList.some((b) => !(editing.names[b.id] ?? b.name).trim()) : false;
  async function onSaveNames(e) {
    e.preventDefault();
    if (!changed.length || emptyName) return;
    setEditing((x) => ({ ...x, busy: true, error: null }));
    try {
      for (const b of changed) await updateBranch(b.id, { name: editing.names[b.id].trim() });
      await reload();
      setEditing(null);
    } catch (err) {
      setEditing((x) => ({ ...x, busy: false, error: err.message }));
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
              <button type="button" className="branch-pick-new"
                onClick={() => { setOpen(false); setEditing({ names: {}, busy: false, error: null }); }}>
                <span className="branch-pick-new-icon">{PENCIL}</span>
                Editar sucursales
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
      {editing && createPortal(
        <FinModal title="Editar sucursales" sub="Cambia el nombre con el que aparece cada sucursal." busy={editing.busy}
          onClose={() => setEditing(null)} onSubmit={onSaveNames}
          footer={(
            <>
              <button type="button" className="btn ghost" disabled={editing.busy} onClick={() => setEditing(null)}>Cancelar</button>
              <button className="btn primary" disabled={editing.busy || !changed.length || emptyName}>
                {editing.busy ? 'Guardando…' : changed.length > 1 ? `Guardar ${changed.length} cambios` : 'Guardar cambios'}
              </button>
            </>
          )}>
          <div className="branch-edit-list">
            {editList.map((b, i) => {
              const val = editing.names[b.id] ?? b.name;
              return (
                <label className="branch-edit-row" key={b.id}>
                  <span className="branch-edit-meta">
                    Sucursal {i + 1}
                    {b.is_default && <span className="branch-edit-tag">Principal</span>}
                    {b.active === false && <span className="branch-edit-tag off">Inactiva</span>}
                    {b.id === branchId && <span className="branch-edit-tag cur">Actual</span>}
                  </span>
                  <input value={val} maxLength={60} autoFocus={i === 0} aria-invalid={!val.trim() || undefined}
                    onChange={(e) => setEditing((x) => ({ ...x, names: { ...x.names, [b.id]: e.target.value } }))} />
                </label>
              );
            })}
          </div>
          {emptyName && <p className="muted branch-pick-hint">Ninguna sucursal puede quedar sin nombre.</p>}
          <p className="muted branch-pick-hint">
            Las ventas, cajas y gastos ya registrados siguen ligados a su sucursal; solo cambia el nombre que se ve.
            Dirección, activar o borrar sucursales y el acceso del personal están en Negocio → Sucursales.
          </p>
          {editing.error && <div className="form-error">{editing.error}</div>}
        </FinModal>,
        document.body,
      )}
    </div>
  );
}
