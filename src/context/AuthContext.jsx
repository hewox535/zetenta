import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchProfile, fetchBusiness, fetchMyBusiness, isSessionAlive } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = cargando
  const [profile, setProfile] = useState(null);
  const [business, setBusiness] = useState(null);
  // Estado del negocio (pendiente de aprobación, activo o desactivado). Solo un
  // negocio activo carga sus datos; los demás ven la pantalla de su estado.
  const [account, setAccount] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Al volver a la pestaña, Supabase refresca el token y emite una sesión
      // nueva del MISMO usuario. Si reemplazamos la referencia, la app entra en
      // "cargando", desmonta la vista y se pierde lo escrito en formularios.
      // Solo actualizamos cuando cambia el usuario (login/logout).
      setSession((prev) => (prev && s && prev.user.id === s.user.id ? prev : s));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Si un administrador cerró esta sesión desde «Sesiones», el token sigue
  // valiendo hasta vencer: se comprueba cada minuto y al volver a la pestaña
  // para sacar al usuario de inmediato.
  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) return undefined;
    let stop = false;
    const check = async () => {
      if (stop || document.visibilityState === 'hidden') return;
      if (!(await isSessionAlive()) && !stop) supabase.auth.signOut({ scope: 'local' });
    };
    const id = setInterval(check, 60000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      stop = true; clearInterval(id);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [userId]);

  const loadAccount = useCallback(async (userId) => {
    const p = await fetchProfile(userId);
    setProfile(p);
    if (!p.business_id) { setAccount(null); setBusiness(null); return; }
    const acc = await fetchMyBusiness();
    setAccount(acc);
    setBusiness(acc?.status === 'active' ? await fetchBusiness(p.business_id) : null);
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      setProfile(null);
      setBusiness(null);
      setAccount(null);
      setReady(true);
      return;
    }
    let active = true;
    setReady(false);
    loadAccount(session.user.id)
      .catch(() => { if (active) { setProfile(null); setBusiness(null); } })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [session, loadAccount]);

  // Tras solicitar la prueba o cambiar la marca estando pendiente.
  const refreshAccount = useCallback(async () => {
    if (session?.user?.id) await loadAccount(session.user.id);
  }, [session, loadAccount]);

  const refreshBusiness = useCallback(async () => {
    if (profile?.business_id) setBusiness(await fetchBusiness(profile.business_id));
  }, [profile]);

  // Tras editar la cuenta (nombre, usuario) recarga el perfil sin recargar la app.
  const refreshProfile = useCallback(async () => {
    if (session?.user?.id) setProfile(await fetchProfile(session.user.id));
  }, [session]);

  // Acepta correo o nombre de usuario: sin '@' se resuelve el username al
  // correo auth vía RPC login_email (los usuarios sin correo real tienen uno
  // sintético que solo sirve para autenticar).
  const signIn = async (identifier, password) => {
    let email = identifier;
    if (!identifier.includes('@')) {
      const { data } = await supabase.rpc('login_email', { p_username: identifier });
      if (!data) return { error: { message: 'Invalid login credentials' } };
      email = data;
    }
    return supabase.auth.signInWithPassword({ email, password });
  };

  // El negocio se crea ya configurado (nombre, subdominio, color) pero pendiente
  // de aprobación: ver 20261130120000_business_status_trial.sql.
  const signUp = (email, password, { businessName, fullName, businessType, slug, accent, accent2 }) =>
    supabase.auth.signUp({
      email,
      password,
      options: { data: {
        business_name: businessName, full_name: fullName, business_type: businessType || 'general',
        slug: slug || '', accent: accent || '', accent2: accent2 || '',
      } },
    });

  const signOut = () => supabase.auth.signOut();

  const isBusinessAdmin = profile?.role === 'platform_admin' || profile?.business_role === 'admin';
  const permissions = profile?.permissions ?? {};

  const value = {
    session: session ?? null,
    loading: session === undefined || !ready,
    user: session?.user ?? null,
    profile,
    business,
    // { status: 'pending' | 'active' | 'disabled', slug, branding, trial_requested_at… } o null
    account,
    refreshAccount,
    isAdmin: profile?.role === 'platform_admin',
    // Rol dentro del negocio: 'admin' (acceso completo) | 'seller' (solo ventas).
    businessRole: profile?.business_role ?? 'admin',
    isBusinessAdmin,
    isSeller: profile?.role !== 'platform_admin' && profile?.business_role === 'seller',
    capabilities: business?.capabilities ?? {},
    // Permisos extra otorgados por el admin del negocio a una vendedora
    // (inventory/stats/retentions). El admin tiene todo sin necesitarlos.
    permissions,
    // Acciones dentro del inventario (inv_edit_info, inv_edit_media,
    // inv_edit_price, inv_edit_stock, inv_create, inv_delete). Requieren
    // además el acceso al módulo; el servidor aplica las mismas reglas.
    canInventory: (key) => isBusinessAdmin || (!!permissions.inventory && !!permissions[key]),
    refreshBusiness,
    refreshProfile,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
