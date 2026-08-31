import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import Brand from '../components/Brand';

// Selector global de sucursal (solo si el usuario tiene acceso a más de una).
function BranchSwitch({ className }) {
  const { branches, branchId, setBranchId } = useBranch();
  if (!branches || branches.length < 2) return null;
  return (
    <select className={`branch-select${className ? ' ' + className : ''}`} value={branchId || ''}
      onChange={(e) => setBranchId(e.target.value)} title="Sucursal actual" aria-label="Sucursal">
      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
}

const Icon = {
  doc: <svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13.5 3.5V9H19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>,
  people: <svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M3.5 19c.7-3 2.9-4.5 5.5-4.5s4.8 1.5 5.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="16.5" cy="9.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M16 14.6c2.3.2 4 1.6 4.5 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  box: <svg viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8l-8 4-8-4V8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M4 8l8 4 8-4M12 12v8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>,
  gear: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M12 2.8l1.2 2.6 2.8-.5 1 2.7 2.7 1-.5 2.8 2.6 1.2-2.6 1.2.5 2.8-2.7 1-1 2.7-2.8-.5L12 21.2l-1.2-2.6-2.8.5-1-2.7-2.7-1 .5-2.8L2.2 12l2.6-1.2-.5-2.8 2.7-1 1-2.7 2.8.5L12 2.8z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  shield: <svg viewBox="0 0 24 24"><path d="M12 3l7 2.5v5.2c0 4.6-3 8.4-7 10.3-4-1.9-7-5.7-7-10.3V5.5L12 3z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9 12l2.2 2.2L15.5 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  cart: <svg viewBox="0 0 24 24"><path d="M4 5h2l1.6 10.4a1 1 0 0 0 1 .85h8.2a1 1 0 0 0 1-.8L20 8H7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><circle cx="9.5" cy="19.5" r="1.4" fill="currentColor"/><circle cx="17" cy="19.5" r="1.4" fill="currentColor"/></svg>,
  chart: <svg viewBox="0 0 24 24"><path d="M4 20V4M4 20h16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M8 20v-6M12 20v-9M16 20v-4M20 20V9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  user: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M4.5 20c.9-3.6 3.6-5.5 7.5-5.5s6.6 1.9 7.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  chevLeft: <svg viewBox="0 0 24 24"><path d="M11.5 6L6 12l5.5 6M18 6l-5.5 6 5.5 6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  chevRight: <svg viewBox="0 0 24 24"><path d="M6 6l5.5 6L6 18M12.5 6L18 12l-5.5 6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  logout: <svg viewBox="0 0 24 24"><path d="M14 4H7a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M11 12h9m0 0l-3.5-3.5M20 12l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

export default function Shell() {
  const { profile, business, capabilities, isAdmin, isBusinessAdmin, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  // Menú lateral contraído a solo íconos (preferencia por dispositivo; el
  // default es abierto). En móvil no aplica: ahí es un cajón deslizante.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('zt-sidebar') === 'collapsed'; } catch { return false; }
  });
  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem('zt-sidebar', next ? 'collapsed' : 'open'); } catch { /* sin almacenamiento */ }
      return next;
    });
  }

  const items = [];
  if (capabilities.orders) {
    items.push({ to: '/orders', label: 'Ventas', icon: Icon.cart });
  }
  if (capabilities.customers) {
    items.push({ to: '/customers', label: 'Clientes', icon: Icon.user });
  }
  // Módulos de administración del negocio: ocultos para la vendedora.
  if (isBusinessAdmin) {
    if (capabilities.inventory) {
      items.push({ to: '/inventory', label: 'Inventario', icon: Icon.box });
    }
    if (capabilities.stats) {
      items.push({ to: '/stats', label: 'Estadísticas', icon: Icon.chart });
    }
    if (capabilities.retentions) {
      items.push({ to: '/retentions', label: 'Retenciones', icon: Icon.doc });
      items.push({ to: '/suppliers', label: 'Proveedores', icon: Icon.people });
    }
    if (business) {
      items.push({ to: '/settings', label: 'Negocio', icon: Icon.gear });
    }
  }
  if (isAdmin) {
    items.push({ to: '/admin', label: 'Administración', icon: Icon.shield });
  }
  // Identidad en el pie: nombre del usuario y, debajo, su correo real o su
  // nombre de usuario (el correo sintético del personal sin correo no se muestra).
  const userName = profile?.full_name || (profile?.username ? `@${profile.username}` : profile?.email);
  const userIdent = profile?.email || (profile?.username ? `@${profile.username}` : '');

  return (
    <div className={`shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      {/* Solo visible en móvil: hamburguesa + marca; la barra lateral se vuelve cajón */}
      <header className="mobile-top no-print">
        <button className="menu-btn" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}>
          <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
        </button>
        <Brand className="sidebar-brand" />
        <BranchSwitch className="mobile" />
      </header>
      {menuOpen && <div className="sidebar-backdrop no-print" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar no-print${menuOpen ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-top">
          <Brand className="sidebar-brand" />
          <button type="button" className="sidebar-collapse" onClick={toggleCollapsed}
            title={collapsed ? 'Expandir menú' : 'Contraer menú'}
            aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}>
            {collapsed ? Icon.chevRight : Icon.chevLeft}
          </button>
        </div>
        <BranchSwitch />
        <nav className="sidebar-nav">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} onClick={() => setMenuOpen(false)} title={it.label}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="nav-icon">{it.icon}</span>
              <span className="nav-label">{it.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{userName}</div>
              <div className="sidebar-user-biz">{userIdent}</div>
            </div>
            <NavLink to="/account" className="sidebar-gear" title="Configuración de la cuenta"
              aria-label="Configuración de la cuenta" onClick={() => setMenuOpen(false)}>
              {Icon.gear}
            </NavLink>
          </div>
          <button className="btn ghost sm sidebar-logout" onClick={signOut} title="Cerrar sesión">
            <span className="logout-icon">{Icon.logout}</span>
            <span className="nav-label">Cerrar sesión</span>
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
