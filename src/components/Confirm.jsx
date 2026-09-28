// Confirmación para acciones sensibles (eliminar, cerrar sesión…) con el
// mismo modal de la app, en vez del confirm() del navegador.
//
//   const ask = useConfirm();
//   if (!await ask({ title: '¿Eliminar a Ana?', message: 'Perderá el acceso.',
//                    confirmLabel: 'Eliminar', tone: 'danger' })) return;
//
// Devuelve una promesa: true si confirma, false si cancela, cierra con Escape
// o toca fuera del modal. En las acciones destructivas el foco arranca en
// "Cancelar" para que un Enter de más no borre nada.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null); // { opts, resolve }

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setReq({ opts: typeof opts === 'string' ? { message: opts } : (opts || {}), resolve });
  }), []);

  const close = useCallback((result) => {
    setReq((r) => { r?.resolve(result); return null; });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {req && <ConfirmModal opts={req.opts} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmModal({ opts, onClose }) {
  const {
    title = '¿Confirmas esta acción?', message = '',
    confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', tone = 'danger',
  } = opts;
  const danger = tone === 'danger';
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    (danger ? cancelRef : confirmRef).current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [danger, onClose]);

  return (
    <div className="modal-backdrop" onClick={() => onClose(false)}>
      <div className="modal card confirm-modal" role="alertdialog" aria-modal="true"
        aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title">{title}</h2>
        {message && <p className="confirm-text">{message}</p>}
        <div className="inline-form-actions confirm-actions">
          <button type="button" ref={confirmRef}
            className={`btn ${danger ? 'danger-solid' : 'primary'}`}
            onClick={() => onClose(true)}>{confirmLabel}</button>
          <button type="button" ref={cancelRef} className="btn ghost"
            onClick={() => onClose(false)}>{cancelLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm debe usarse dentro de <ConfirmProvider>');
  return ctx;
}
