import { useState } from 'react';

// Persistencia simple en localStorage: cada clave es un "slice" del estado.
export function useStored(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  const set = (next) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      localStorage.setItem(key, JSON.stringify(resolved));
      return resolved;
    });
  };
  return [value, set];
}

export const DEFAULT_EMPRESA = {
  nombre: 'AUTO VIDRIOS DUGLARIS, C.A.',
  rif: 'J-313620220',
  direccion: 'CALLE SUCRE LOCAL Nº 15-A, SECTOR BARRIO SUCRE, BARCELONA EDO. ANZOATEGUI',
  nextSeq: 137,
};
