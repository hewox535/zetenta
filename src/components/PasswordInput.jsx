import { useState } from 'react';

// Input de contraseña con botón "ojito" para mostrar/ocultar. Reenvía el resto
// de props (value, onChange, minLength, autoComplete, required, autoFocus…) al
// <input> nativo, así se comporta igual que cualquier campo.
export default function PasswordInput(props) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-field">
      <input {...props} type={show ? 'text' : 'password'} />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={show}
        tabIndex={-1}
      >
        {show ? (
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M3 3l18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="M9.9 5.2A9.5 9.5 0 0 1 12 5c5 0 9 4.5 9 7 0 .9-.9 2.4-2.4 3.7M6.2 6.7C4 8.1 3 9.9 3 12c0 2.5 4 7 9 7 1.2 0 2.4-.3 3.4-.7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.7"/></svg>
        )}
      </button>
    </div>
  );
}
