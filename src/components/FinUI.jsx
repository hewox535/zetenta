import { useEffect, useRef, useState } from 'react';

// Piezas comunes de Cuentas y Gastos: el modal con cabecera y pie fijos, el
// menú de acciones de cada fila y el aviso de "listo".

const X = (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
);

export function FinModal({ title, sub, onClose, busy, children, footer, onSubmit, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const Body = onSubmit ? 'form' : 'div';
  return (
    <div className="modal-backdrop fm-backdrop" onClick={() => !busy && onClose()}>
      <Body className={`fm${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}
        onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <header className="fm-head">
          <div className="fm-title">
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button type="button" className="fm-close" aria-label="Cerrar" disabled={busy} onClick={onClose}>{X}</button>
        </header>
        <div className="fm-body">{children}</div>
        {footer && <footer className="fm-foot">{footer}</footer>}
      </Body>
    </div>
  );
}

// Menú "⋯" de una fila. items: [{ label, onClick, danger, hidden }]
export function RowMenu({ items, label = 'Más acciones' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return <span className="rm-spacer" />;
  return (
    <div className="rm" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="rm-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor"/></svg>
      </button>
      {open && (
        <div className="rm-menu" role="menu">
          {visible.map((i) => (
            <button key={i.label} type="button" role="menuitem" className={i.danger ? 'danger' : ''}
              onClick={() => { setOpen(false); i.onClick(); }}>{i.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// Aviso flotante de confirmación. toast: { text, sub } | null
export function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return (
    <div className="fin-toast" role="status" aria-live="polite">
      <span className="fin-toast-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </span>
      <span><strong>{toast.text}</strong>{toast.sub && <span className="muted"> · {toast.sub}</span>}</span>
    </div>
  );
}

// Cabecera de columna ordenable.
export function SortHead({ label, k, sort, setSort, align }) {
  const active = sort.key === k;
  return (
    <button type="button" className={`sh${active ? ' on' : ''}${align === 'right' ? ' right' : ''}`}
      onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'asc' ? 'desc' : 'asc' }))}>
      {label}
      <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true" className={active && sort.dir === 'desc' ? 'desc' : ''}>
        <path d="M5 2l3 4H2z" fill="currentColor"/>
      </svg>
    </button>
  );
}
