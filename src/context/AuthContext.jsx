import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchProfile, fetchBusiness } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = cargando
  const [profile, setProfile] = useState(null);
  const [business, setBusiness] = useState(null);
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

  const loadAccount = useCallback(async (userId) => {
    const p = await fetchProfile(userId);
    setProfile(p);
    setBusiness(p.business_id ? await fetchBusiness(p.business_id) : null);
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      setProfile(null);
      setBusiness(null);
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

  const refreshBusiness = useCallback(async () => {
    if (profile?.business_id) setBusiness(await fetchBusiness(profile.business_id));
  }, [profile]);

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });

  const signUp = (email, password, { businessName, fullName }) =>
    supabase.auth.signUp({
      email,
      password,
      options: { data: { business_name: businessName, full_name: fullName } },
    });

  const signOut = () => supabase.auth.signOut();

  const value = {
    session: session ?? null,
    loading: session === undefined || !ready,
    user: session?.user ?? null,
    profile,
    business,
    isAdmin: profile?.role === 'platform_admin',
    capabilities: business?.capabilities ?? {},
    refreshBusiness,
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
