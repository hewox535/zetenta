import { useBranding } from '../context/BrandingContext';
import Brand from './Brand';
import { Z_CELLS, WORDMARK_D } from '../../landing/src/brand.js';
import './AuthLayout.css';

// Marco de las pantallas de acceso (login, registro, contraseñas).
// - En zetenta.app (sin negocio en el dominio): la estética de la landing,
//   con el panel nocturno de la Z LED y el formulario sobre papel.
// - En el dominio de un negocio: la tarjeta neutra con su marca (white-label);
//   Zetenta no aparece.
export default function AuthLayout({ children, title, sub }) {
  const { businessId } = useBranding();

  if (businessId) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <Brand className="auth-brand" />
          <h1>{title}</h1>
          {sub && <p className="auth-sub">{sub}</p>}
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="zauth">
      <aside className="zauth-side" aria-hidden="true">
        <div className="zauth-sky" />
        <div className="zauth-dots" />
        <svg className="zauth-z" viewBox="0 0 288 288">
          {Array.from({ length: 25 }, (_, k) => {
            const r = Math.floor(k / 5), c = k % 5;
            const i = Z_CELLS.findIndex(([zr, zc]) => zr === r && zc === c);
            return (
              <rect key={k} x={c * 60} y={r * 60} width="48" height="48" rx="12"
                className={i >= 0 ? 'on' : 'off'} style={i >= 0 ? { '--i': i } : undefined} />
            );
          })}
        </svg>
        <div className="zauth-side-copy">
          <p className="zauth-lema">Tus cuentas<br />de la <b>A</b> a la <b>Z</b>.</p>
          <div className="zauth-visor">
            <span>VENTA REGISTRADA · BS. 2.450,00</span>
            <span>TU CAJA CUADRA · $1.284,50</span>
            <span>PEDIDO DESDE TU CATÁLOGO</span>
            <span>TASA BCV DEL DÍA</span>
          </div>
        </div>
      </aside>

      <main className="zauth-main">
        <div className="zauth-card">
          <a href="/" className="zauth-logo" aria-label="Zetenta">
            <svg viewBox="0 0 288 288" className="zauth-logo-z">
              {Z_CELLS.map(([r, c]) => <rect key={`${r}-${c}`} x={c * 60} y={r * 60} width="48" height="48" rx="12" />)}
            </svg>
            <svg viewBox="-8 -168 730.2 222" className="zauth-logo-word"><path d={WORDMARK_D} /></svg>
          </a>
          <h1>{title}</h1>
          {sub && <p className="zauth-sub">{sub}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
