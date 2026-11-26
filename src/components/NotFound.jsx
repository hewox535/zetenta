import { useEffect, useRef, useState } from 'react';
import './notfound.css';

// Página genérica de "no encontrado": subdominios que no existen y negocios
// pendientes o desactivados. Sin marca de nadie (ni de Zetenta): solo una
// estética limpia y una animación de luz que sigue el puntero.
export default function NotFound() {
  const stage = useRef(null);
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.length > 1);

  // El orbe sigue el puntero con suavidad (parallax); en táctil, respira solo.
  useEffect(() => {
    const el = stage.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let raf = 0; let tx = 0; let ty = 0; let x = 0; let y = 0;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    const tick = () => {
      x += (tx - x) * 0.06; y += (ty - y) * 0.06;
      el.style.setProperty('--px', x.toFixed(3));
      el.style.setProperty('--py', y.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', onMove);
    raf = requestAnimationFrame(tick);
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
  }, []);

  return (
    <main className="nf" ref={stage}>
      <div className="nf-orb" aria-hidden="true">
        <div className="nf-glow" />
        <div className="nf-glow nf-glow-2" />
        <div className="nf-glass">
          <svg viewBox="0 0 64 64" className="nf-icon">
            <circle cx="28" cy="28" r="16" className="nf-draw" />
            <path d="M40 40l12 12" className="nf-draw nf-draw-2" />
            <path d="M22.5 28h11" className="nf-draw nf-draw-3" />
          </svg>
        </div>
      </div>

      <div className="nf-copy">
        <p className="nf-eyebrow">Error 404</p>
        <h1 className="nf-title">Esta página no existe.</h1>
        <p className="nf-sub">Es posible que la dirección no sea correcta o que la página ya no esté disponible.</p>
        {canGoBack && (
          <button type="button" className="nf-btn" onClick={() => window.history.back()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            Volver
          </button>
        )}
      </div>
    </main>
  );
}
