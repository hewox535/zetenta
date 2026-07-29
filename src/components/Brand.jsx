import { useBranding } from '../context/BrandingContext';

// Muestra el logo del negocio si el white-label lo definió; si no, el nombre
// como wordmark. `className` hereda los estilos de marca del lugar donde se usa
// (auth-brand, sidebar-brand, splash-brand).
export default function Brand({ className }) {
  const { name, logoUrl } = useBranding();
  if (logoUrl) {
    return <img className={`brand-logo ${className || ''}`} src={logoUrl} alt={name} />;
  }
  return <div className={className}>{name}</div>;
}
