import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BranchProvider } from './context/BranchContext';
import { BrandingProvider, useBranding } from './context/BrandingContext';
import Brand from './components/Brand';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Shell from './pages/Shell';
import Retentions from './pages/Retentions';
import RetentionNew from './pages/RetentionNew';
import RetentionView from './pages/RetentionView';
import Suppliers from './pages/Suppliers';
import Customers from './pages/Customers';
import Inventory from './pages/Inventory';
import InventoryHistory from './pages/InventoryHistory';
import Orders from './pages/Orders';
import OrdersHistory from './pages/OrdersHistory';
import OrderView from './pages/OrderView';
import Stats from './pages/Stats';
import Settings from './pages/Settings';
import Admin from './pages/Admin';

function Splash() {
  return <div className="splash"><Brand className="splash-brand" /></div>;
}

// Anti-parpadeo de marca: hasta resolver el white-label del dominio (o tenerlo en
// caché), mostramos un splash neutro en vez de la marca Zetenta por defecto, para
// no enseñar una marca y luego cambiarla.
function BrandGate({ children }) {
  const { ready, fromCache } = useBranding();
  if (!ready && !fromCache) return <div className="brand-splash"><span className="brand-spinner" /></div>;
  return children;
}

// En dominios white-label (el host resuelve a un negocio) no se permite crear
// cuentas nuevas: el registro es solo para la plataforma Zetenta.
function RequirePublicSignup({ children }) {
  const { businessId } = useBranding();
  if (businessId) return <Navigate to="/login" replace />;
  return children;
}

function RequireAuth({ children }) {
  const { loading, session } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

// Pantallas de administración del negocio (inventario, stats, configuración):
// la vendedora no accede a ellas.
function RequireBusinessAdmin({ children }) {
  const { isBusinessAdmin } = useAuth();
  if (!isBusinessAdmin) return <Navigate to="/" replace />;
  return children;
}

function RequireCapability({ name, children }) {
  const { capabilities, isAdmin } = useAuth();
  if (!isAdmin && !capabilities[name]) return <Navigate to="/" replace />;
  return children;
}

// Punto de entrada tras el login: primer módulo disponible según rol y capabilities
function Home() {
  const { isAdmin, isSeller, capabilities } = useAuth();
  if (isAdmin) return <Navigate to="/admin" replace />;
  if (isSeller) return <Navigate to="/orders" replace />;
  if (capabilities.orders) return <Navigate to="/orders" replace />;
  if (capabilities.retentions) return <Navigate to="/retentions" replace />;
  if (capabilities.inventory) return <Navigate to="/inventory" replace />;
  return <Navigate to="/settings" replace />;
}

export default function App() {
  return (
    <BrandingProvider>
    <BrandGate>
    <AuthProvider>
      <BranchProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<RequirePublicSignup><Register /></RequirePublicSignup>} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/" element={<RequireAuth><Shell /></RequireAuth>}>
            <Route index element={<Home />} />
            <Route path="retentions" element={<RequireBusinessAdmin><RequireCapability name="retentions"><Retentions /></RequireCapability></RequireBusinessAdmin>} />
            <Route path="retentions/new" element={<RequireBusinessAdmin><RequireCapability name="retentions"><RetentionNew /></RequireCapability></RequireBusinessAdmin>} />
            <Route path="retentions/:id/edit" element={<RequireBusinessAdmin><RequireCapability name="retentions"><RetentionNew /></RequireCapability></RequireBusinessAdmin>} />
            <Route path="retentions/:id" element={<RequireBusinessAdmin><RetentionView /></RequireBusinessAdmin>} />
            <Route path="suppliers" element={<RequireBusinessAdmin><RequireCapability name="retentions"><Suppliers /></RequireCapability></RequireBusinessAdmin>} />
            <Route path="customers" element={<RequireCapability name="customers"><Customers /></RequireCapability>} />
            <Route path="inventory" element={<RequireBusinessAdmin><RequireCapability name="inventory"><Inventory /></RequireCapability></RequireBusinessAdmin>} />
            <Route path="inventory/history" element={<RequireBusinessAdmin><RequireCapability name="inventory"><InventoryHistory /></RequireCapability></RequireBusinessAdmin>} />
            <Route path="orders" element={<RequireCapability name="orders"><Orders /></RequireCapability>} />
            <Route path="orders/history" element={<RequireCapability name="orders"><OrdersHistory /></RequireCapability>} />
            <Route path="orders/:id" element={<RequireCapability name="orders"><OrderView /></RequireCapability>} />
            <Route path="stats" element={<RequireBusinessAdmin><RequireCapability name="stats"><Stats /></RequireCapability></RequireBusinessAdmin>} />
            <Route path="settings" element={<RequireBusinessAdmin><Settings /></RequireBusinessAdmin>} />
            <Route path="admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </BranchProvider>
    </AuthProvider>
    </BrandGate>
    </BrandingProvider>
  );
}
