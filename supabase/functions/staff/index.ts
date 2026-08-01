// API: gestión de personal del negocio (vendedoras). Solo un administrador del
// negocio puede crear o eliminar usuarios de su propio negocio.
//
//   POST /functions/v1/staff
//   Authorization: Bearer <access_token del admin>   (+ header apikey)
//   Body JSON:
//     { action: "create", email, password, full_name? }
//     { action: "delete", user_id }
//
//   200 → { ok: true, user? }   4xx/5xx → { error }
//
// Usa el service role (admin API) para crear/eliminar el usuario auth, pero
// valida SIEMPRE con el token del solicitante que sea admin del negocio.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Usa POST.' }, 405);

  try {
    // Cliente con el token del solicitante (para identificarlo bajo RLS).
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    );
    const { data: userData, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Token inválido.' }, 401);

    const { data: me } = await asUser
      .from('profiles').select('business_id, business_role, role').eq('id', userData.user.id).single();
    if (!me?.business_id || me.business_role !== 'admin') {
      return json({ error: 'Solo un administrador del negocio puede gestionar personal.' }, 403);
    }

    const body = await req.json().catch(() => null);
    if (!body?.action) return json({ error: 'Falta la acción.' }, 400);

    // Cliente con service role para la admin API.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    if (body.action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const fullName = String(body.full_name || '').trim();
      if (!email || password.length < 6) {
        return json({ error: 'Correo válido y contraseña de al menos 6 caracteres.' }, 400);
      }
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName },
      });
      if (cErr || !created?.user) return json({ error: cErr?.message || 'No se pudo crear el usuario.' }, 400);

      // El trigger handle_new_user creó el perfil (sin negocio). Lo asignamos.
      const { error: uErr } = await admin.from('profiles')
        .update({ business_id: me.business_id, business_role: 'seller', full_name: fullName, email })
        .eq('id', created.user.id);
      if (uErr) {
        await admin.auth.admin.deleteUser(created.user.id); // rollback
        return json({ error: uErr.message }, 400);
      }
      return json({ ok: true, user: { id: created.user.id, email, full_name: fullName } });
    }

    if (body.action === 'delete') {
      const userId = String(body.user_id || '');
      if (!userId) return json({ error: 'Falta user_id.' }, 400);
      if (userId === userData.user.id) return json({ error: 'No puedes eliminarte a ti mismo.' }, 400);
      const { data: target } = await admin.from('profiles')
        .select('business_id, role').eq('id', userId).single();
      if (!target || target.business_id !== me.business_id) {
        return json({ error: 'Usuario no encontrado en tu negocio.' }, 404);
      }
      if (target.role === 'platform_admin') return json({ error: 'No permitido.' }, 403);
      const { error: dErr } = await admin.auth.admin.deleteUser(userId);
      if (dErr) return json({ error: dErr.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Acción no reconocida.' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
