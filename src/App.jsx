import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BrandingProvider } from './context/BrandingContext';
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
import Inventory from './pages/Inventory';
import Orders from './pages/Orders';
import OrdersHistory from './pages/OrdersHistory';
import OrderView from './pages/OrderView';
import Stats from './pages/Stats';
import Settings from './pages/Settings';
import Admin from './pages/Admin';

function Splash() {
  return <div className="splash"><Brand className="splash-brand" /></div>;
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

function RequireCapability({ name, children }) {
  const { capabilities, isAdmin } = useAuth();
  if (!isAdmin && !capabilities[name]) return <Navigate to="/" replace />;
  return children;
}

// Punto de entrada tras el login: primer módulo disponible según rol y capabilities
function Home() {
  const { isAdmin, capabilities } = useAuth();
  if (isAdmin) return <Navigate to="/admin" replace />;
  if (capabilities.orders) return <Navigate to="/orders" replace />;
  if (capabilities.retentions) return <Navigate to="/retentions" replace />;
  if (capabilities.inventory) return <Navigate to="/inventory" replace />;
  return <Navigate to="/settings" replace />;
}

export default function App() {
  return (
    <BrandingProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/" element={<RequireAuth><Shell /></RequireAuth>}>
            <Route index element={<Home />} />
            <Route path="retentions" element={<RequireCapability name="retentions"><Retentions /></RequireCapability>} />
            <Route path="retentions/new" element={<RequireCapability name="retentions"><RetentionNew /></RequireCapability>} />
            <Route path="retentions/:id" element={<RetentionView />} />
            <Route path="suppliers" element={<RequireCapability name="retentions"><Suppliers /></RequireCapability>} />
            <Route path="inventory" element={<RequireCapability name="inventory"><Inventory /></RequireCapability>} />
            <Route path="orders" element={<RequireCapability name="orders"><Orders /></RequireCapability>} />
            <Route path="orders/history" element={<RequireCapability name="orders"><OrdersHistory /></RequireCapability>} />
            <Route path="orders/:id" element={<RequireCapability name="orders"><OrderView /></RequireCapability>} />
            <Route path="stats" element={<RequireCapability name="stats"><Stats /></RequireCapability>} />
            <Route path="settings" element={<Settings />} />
            <Route path="admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </BrandingProvider>
  );
}
