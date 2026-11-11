import { useEffect, useMemo, useState } from 'react';
import { fetchBusinessSessions, revokeBusinessSession, revokeBusinessSessions } from '../lib/api';
import { useConfirm } from './Confirm';

const ROLE_LABEL = { admin: 'Administrador', seller: 'Vendedora' };

// "Chrome · Windows", tipo de equipo para el ícono.
export function describeDevice(ua = '') {
  const browser =
    /Edg\//.test(ua) ? 'Edge'
      : /OPR\/|Opera/.test(ua) ? 'Opera'
        : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
          : /CriOS|Chrome\//.test(ua) ? 'Chrome'
            : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
              : /Safari\//.test(ua) ? 'Safari'
                : '';
  const os =
    /iPhone/.test(ua) ? 'iPhone'
      : /iPad/.test(ua) ? 'iPad'
        : /Android/.test(ua) ? 'Android'
          : /Windows/.test(ua) ? 'Windows'
            : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
              : /CrOS/.test(ua) ? 'Chromebook'
                : /Linux/.test(ua) ? 'Linux'
                  : '';
  const kind = /iPad|Tablet/.test(ua) ? 'tablet' : /iPhone|Android.*Mobile|Mobile/.test(ua) ? 'phone' : 'desktop';
  const label = [browser, os].filter(Boolean).join(' · ') || 'Dispositivo desconocido';
  return { label, kind };
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 120) return 'Activa ahora';
  const m = Math.round(s / 60);
  if (m < 60) return `Activa hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `Activa hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Activa ayer' : `Activa hace ${d} días`;
}
const fmtDate = (iso) => new Date(iso).toLocaleDateString('es-VE', { day: 'numeric', month: 'short', year: 'numeric' });

const ICONS = {
  desktop: <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="M9 20h6M12 16v4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>,
  phone: <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="M11 18.5h2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>,
  tablet: <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="4.5" y="2.5" width="15" height="19" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="M11 18.5h2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>,
};

export default function SessionsSection() {
  const ask = useConfirm();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(null); // id de sesión/usuario en curso, o 'all'

  const load = () => fetchBusinessSessions().then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  // Agrupadas por usuario; el grupo con mi sesión primero.
  const groups = useMemo(() => {
    const m = new Map();
    (rows || []).forEach((s) => {
      if (!m.has(s.user_id)) m.set(s.user_id, { user: s, sessions: [] });
      m.get(s.user_id).sessions.push(s);
    });
    return [...m.values()].sort((a, b) =>
      Number(b.sessions.some((s) => s.is_current)) - Number(a.sessions.some((s) => s.is_current)));
  }, [rows]);
  const others = (rows || []).filter((s) => !s.is_current).length;
  const nameOf = (u) => u.full_name || (u.username ? `@${u.username}` : u.email) || 'Usuario';

  async function run(key, fn, msg) {
    setError(null); setOk(null); setBusy(key);
    try { await fn(); setOk(msg); await load(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  const closeOne = async (s) => {
    const { label } = describeDevice(s.user_agent);
    if (!await ask({ title: '¿Cerrar esta sesión?', message: `${nameOf(s)} tendrá que volver a iniciar sesión en ${label}.`, confirmLabel: 'Cerrar sesión' })) return;
    run(s.id, () => revokeBusinessSession(s.id), 'Sesión cerrada.');
  };
  const closeUser = async (g) => {
    const mine = g.sessions.some((s) => s.is_current);
    if (!await ask({
      title: `¿Cerrar las sesiones de ${nameOf(g.user)}?`,
      message: mine ? 'Se cierran tus otros dispositivos; este se mantiene abierto.' : 'Tendrá que volver a iniciar sesión en todos sus dispositivos.',
      confirmLabel: 'Cerrar sesiones',
    })) return;
    run(g.user.user_id, () => revokeBusinessSessions(g.user.user_id), 'Sesiones cerradas.');
  };
  const closeAll = async () => {
    if (!await ask({
      title: '¿Cerrar todas las sesiones?',
      message: 'Todos los usuarios del negocio tendrán que volver a iniciar sesión. Tu sesión en este dispositivo se mantiene abierta.',
      confirmLabel: 'Cerrar todas',
    })) return;
    run('all', () => revokeBusinessSessions(null), 'Se cerraron todas las demás sesiones.');
  };

  return (
    <div className="vform">
      <section className="card vsection">
        <div className="ses-head">
          <div>
            <h2>Sesiones abiertas</h2>
            <p className="hint">
              Quién tiene abierto el sistema y en qué dispositivo. Si cierras una sesión, ese
              dispositivo sale al inicio de sesión en menos de un minuto.
            </p>
          </div>
          {others > 0 && (
            <button type="button" className="btn danger sm ses-all" onClick={closeAll} disabled={!!busy}>
              {busy === 'all' ? 'Cerrando…' : 'Cerrar todas las sesiones'}
            </button>
          )}
        </div>

        {error && <div className="form-error">{error}</div>}
        {ok && <div className="form-ok">{ok}</div>}

        {rows === null ? (
          <div className="empty">Cargando…</div>
        ) : groups.length === 0 ? (
          <div className="empty">No hay sesiones abiertas.</div>
        ) : (
          <div className="ses-groups">
            {groups.map((g) => {
              const closable = g.sessions.filter((s) => !s.is_current).length;
              return (
                <div className="ses-group" key={g.user.user_id}>
                  <div className="ses-user">
                    <span className="ses-avatar" aria-hidden="true">{nameOf(g.user).replace('@', '').slice(0, 1).toUpperCase()}</span>
                    <div className="ses-user-text">
                      <strong>{nameOf(g.user)}</strong>
                      <span className="muted">
                        {ROLE_LABEL[g.user.business_role] || 'Usuario'} · {g.sessions.length} {g.sessions.length === 1 ? 'sesión' : 'sesiones'}
                      </span>
                    </div>
                    {closable > 0 && g.sessions.length > 1 && (
                      <button type="button" className="btn ghost sm ses-user-close" onClick={() => closeUser(g)} disabled={!!busy}>
                        {busy === g.user.user_id ? 'Cerrando…' : g.sessions.some((s) => s.is_current) ? 'Cerrar las demás' : 'Cerrar todas'}
                      </button>
                    )}
                  </div>
                  <ul className="ses-list">
                    {g.sessions.map((s) => {
                      const dev = describeDevice(s.user_agent);
                      return (
                        <li className={`ses-row${s.is_current ? ' current' : ''}`} key={s.id}>
                          <span className="ses-icon">{ICONS[dev.kind]}</span>
                          <div className="ses-info">
                            <span className="ses-device">
                              {dev.label}
                              {s.is_current && <span className="ses-badge">Este dispositivo</span>}
                            </span>
                            <span className="ses-meta">
                              <span className={s.is_current ? 'ses-live' : ''}>{s.is_current ? 'Activa ahora' : ago(s.last_active_at)}</span>
                              <span>Inició {fmtDate(s.created_at)}</span>
                              {s.ip && <span className="mono">{s.ip}</span>}
                            </span>
                          </div>
                          {!s.is_current && (
                            <button type="button" className="btn danger sm" onClick={() => closeOne(s)} disabled={!!busy}>
                              {busy === s.id ? 'Cerrando…' : 'Cerrar'}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
