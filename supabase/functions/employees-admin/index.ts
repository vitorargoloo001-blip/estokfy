// Admin operations on employees: update, reset_password, delete
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_ROLES = ['owner', 'admin', 'manager', 'sales', 'stock', 'finance', 'viewer'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: 'Unauthorized' }, 401);
    const actorAuthId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const { action, profile_id, full_name, email, phone, role, password } = body || {};

    if (!action || !profile_id) return json({ error: 'Parâmetros ausentes' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE);

    const { data: actor } = await admin
      .from('profiles')
      .select('id, store_id, role')
      .eq('auth_user_id', actorAuthId)
      .maybeSingle();
    if (!actor) return json({ error: 'Perfil não encontrado' }, 403);
    if (!['owner', 'admin', 'manager'].includes(actor.role)) return json({ error: 'Sem permissão' }, 403);

    const { data: target } = await admin
      .from('profiles')
      .select('id, store_id, role, auth_user_id, full_name, phone')
      .eq('id', profile_id)
      .maybeSingle();
    if (!target) return json({ error: 'Funcionário não encontrado' }, 404);
    if (target.store_id !== actor.store_id) return json({ error: 'Outra loja' }, 403);
    if (target.id === actor.id && action !== 'update') return json({ error: 'Não pode executar essa ação em si mesmo' }, 400);

    if (action === 'update') {
      const patch: any = {};
      if (typeof full_name === 'string') patch.full_name = full_name;
      if (typeof phone === 'string' || phone === null) patch.phone = phone || null;
      if (role) {
        if (!VALID_ROLES.includes(role)) return json({ error: 'Cargo inválido' }, 400);
        if (['owner', 'admin'].includes(role) && actor.role !== 'owner') {
          return json({ error: 'Apenas proprietário pode definir Proprietário/Administrador' }, 403);
        }
        if (target.role === 'owner' && role !== 'owner') {
          // protect last owner
          const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true })
            .eq('store_id', actor.store_id).eq('role', 'owner').eq('is_active', true);
          if ((count ?? 0) <= 1) return json({ error: 'Não pode rebaixar o único proprietário' }, 400);
        }
        patch.role = role;
      }
      if (email && target.auth_user_id) {
        const { error: emErr } = await admin.auth.admin.updateUserById(target.auth_user_id, { email });
        if (emErr) return json({ error: emErr.message }, 400);
      }
      if (Object.keys(patch).length) {
        const { error: upErr } = await admin.from('profiles').update(patch).eq('id', profile_id);
        if (upErr) return json({ error: upErr.message }, 400);
      }
      await admin.from('audit_logs').insert({
        store_id: actor.store_id, actor_profile_id: actor.id,
        action: 'employee_updated', entity: 'profile', entity_id: target.auth_user_id,
        before_json: { full_name: target.full_name, phone: target.phone, role: target.role },
        after_json: { ...patch, email: email || undefined },
      });
      return json({ ok: true });
    }

    if (action === 'reset_password') {
      if (!password || String(password).length < 6) return json({ error: 'Senha deve ter pelo menos 6 caracteres' }, 400);
      if (!target.auth_user_id) return json({ error: 'Usuário sem auth' }, 400);
      const { error: pwErr } = await admin.auth.admin.updateUserById(target.auth_user_id, { password });
      if (pwErr) return json({ error: pwErr.message }, 400);
      await admin.from('audit_logs').insert({
        store_id: actor.store_id, actor_profile_id: actor.id,
        action: 'employee_password_reset', entity: 'profile', entity_id: target.auth_user_id,
      });
      return json({ ok: true });
    }

    if (action === 'delete') {
      if (actor.role !== 'owner') return json({ error: 'Apenas proprietário pode excluir' }, 403);
      if (target.role === 'owner') return json({ error: 'Não pode excluir proprietário' }, 400);
      // Deactivate profile (keep FK refs intact), then delete auth user
      await admin.from('profiles').update({ is_active: false, role: 'viewer' }).eq('id', profile_id);
      if (target.auth_user_id) {
        await admin.auth.admin.deleteUser(target.auth_user_id).catch((e) => console.warn('deleteUser', e?.message));
      }
      await admin.from('audit_logs').insert({
        store_id: actor.store_id, actor_profile_id: actor.id,
        action: 'employee_deleted', entity: 'profile', entity_id: target.auth_user_id,
        before_json: { full_name: target.full_name, role: target.role },
      });
      return json({ ok: true });
    }

    return json({ error: 'Ação inválida' }, 400);
  } catch (e: any) {
    console.error('[employees-admin] unexpected', e?.message);
    return json({ error: e?.message || 'Erro inesperado' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
