import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Icon = {
  doc: <svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13.5 3.5V9H19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>,
  people: <svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M3.5 19c.7-3 2.9-4.5 5.5-4.5s4.8 1.5 5.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="16.5" cy="9.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M16 14.6c2.3.2 4 1.6 4.5 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  box: <svg viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8l-8 4-8-4V8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M4 8l8 4 8-4M12 12v8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>,
  gear: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M12 2.8l1.2 2.6 2.8-.5 1 2.7 2.7 1-.5 2.8 2.6 1.2-2.6 1.2.5 2.8-2.7 1-1 2.7-2.8-.5L12 21.2l-1.2-2.6-2.8.5-1-2.7-2.7-1 .5-2.8L2.2 12l2.6-1.2-.5-2.8 2.7-1 1-2.7 2.8.5L12 2.8z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  shield: <svg viewBox="0 0 24 24"><path d="M12 3l7 2.5v5.2c0 4.6-3 8.4-7 10.3-4-1.9-7-5.7-7-10.3V5.5L12 3z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9 12l2.2 2.2L15.5 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

export default function Shell() {
  const { profile, business, capabilities, isAdmin, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const items = [];
  if (capabilities.retentions) {
    items.push({ to: '/retentions', label: 'Retenciones', icon: Icon.doc });
    items.push({ to: '/suppliers', label: 'Proveedores', icon: Icon.people });
  }
  if (capabilities.inventory) {
    items.push({ to: '/inventory', label: 'Inventario', icon: Icon.box });
  }
  if (business) {
    items.push({ to: '/settings', label: 'Negocio', icon: Icon.gear });
  }
  if (isAdmin) {
    items.push({ to: '/admin', label: 'Administración', icon: Icon.shield });
  }

  return (
    <div className="shell">
      {/* Solo visible en móvil: hamburguesa + marca; la barra lateral se vuelve cajón */}
      <header className="mobile-top no-print">
        <button className="menu-btn" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}>
          <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
        </button>
        <div className="sidebar-brand">zetenta</div>
      </header>
      {menuOpen && <div className="sidebar-backdrop no-print" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar no-print${menuOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">zetenta</div>
        <nav className="sidebar-nav">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="nav-icon">{it.icon}</span>
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-name">{profile?.full_name || profile?.email}</div>
            <div className="sidebar-user-biz">{isAdmin ? 'Administrador de la plataforma' : business?.name}</div>
          </div>
          <button className="btn ghost sm" onClick={signOut}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
