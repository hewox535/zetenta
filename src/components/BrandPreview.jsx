// Vista previa en vivo de cómo se verá el panel de un negocio con su marca:
// una ventana con su dirección, el menú con su logo (o inicial) y un botón con
// su color. Se usa en el registro y en la espera de aprobación.
export default function BrandPreview({ name, slug, accent, logoUrl }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div className="bp" style={{ '--bp-accent': accent || '#2323FF' }} aria-label={`Vista previa de ${name || 'tu negocio'}`}>
      <div className="bp-bar">
        <span className="bp-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="bp-url">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 7V5a3 3 0 0 1 6 0v2M4 7h8v6H4z" /></svg>
          <span><b>{slug || 'tu-negocio'}</b>.zetenta.app</span>
        </span>
      </div>
      <div className="bp-body">
        <div className="bp-side">
          <div className="bp-brand">
            {logoUrl ? <img src={logoUrl} alt="" /> : <span className="bp-initial">{initial}</span>}
            {!logoUrl && <span className="bp-name">{name || 'Tu negocio'}</span>}
          </div>
          {['Ventas', 'Inventario', 'Estadísticas'].map((t, i) => (
            <span key={t} className={`bp-nav${i === 0 ? ' on' : ''}`}><i />{t}</span>
          ))}
        </div>
        <div className="bp-main">
          <span className="bp-h" />
          <span className="bp-line" />
          <div className="bp-cards"><span /><span /><span /></div>
          <span className="bp-btn">Cobrar</span>
        </div>
      </div>
    </div>
  );
}
