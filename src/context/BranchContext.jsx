import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { fetchBranches, fetchUserBranches } from '../lib/api';

// Sucursal "actual" en la que opera el usuario. La marca (branchId) se guarda por
// negocio en localStorage. La lista `branches` es la de sucursales a las que el
// usuario tiene acceso (todas si all_branches; si no, las de user_branches).
const BranchContext = createContext(null);

export function BranchProvider({ children }) {
  const { business, profile } = useAuth();
  const [allBranches, setAllBranches] = useState([]); // todas las del negocio
  const [branches, setBranches] = useState([]);       // accesibles al usuario
  const [branchId, setBranchIdState] = useState(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!business) { setAllBranches([]); setBranches([]); setBranchIdState(null); setReady(true); return; }
    try {
      const all = await fetchBranches();
      let accessible = all.filter((b) => b.active);
      if (!profile?.all_branches) {
        const ub = await fetchUserBranches();
        const allowed = new Set(ub.filter((x) => x.user_id === profile?.id).map((x) => x.branch_id));
        const filtered = accessible.filter((b) => allowed.has(b.id));
        accessible = filtered.length ? filtered : all.filter((b) => b.is_default); // nunca dejar sin sucursal
      }
      setAllBranches(all);
      setBranches(accessible);
      const key = `zt-branch:${business.id}`;
      let saved = null;
      try { saved = localStorage.getItem(key); } catch { /* sin storage */ }
      const pick = accessible.find((b) => b.id === saved) || accessible.find((b) => b.is_default) || accessible[0] || null;
      setBranchIdState(pick?.id || null);
    } catch { /* silencioso: la app funciona con la sucursal por defecto del servidor */ }
    finally { setReady(true); }
  }, [business, profile]);

  useEffect(() => { setReady(false); load(); }, [load]);

  const setBranchId = useCallback((id) => {
    setBranchIdState(id);
    if (business) { try { localStorage.setItem(`zt-branch:${business.id}`, id); } catch { /* ignore */ } }
  }, [business]);

  const currentBranch = branches.find((b) => b.id === branchId) || null;

  const value = { branches, allBranches, branchId, setBranchId, currentBranch, ready, reload: load };
  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error('useBranch debe usarse dentro de <BranchProvider>');
  return ctx;
}
