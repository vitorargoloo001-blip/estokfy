// Create employee with initial password (no email invite)
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
    const inviterAuthId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const { email, full_name, role, password, phone } = body || {};

    if (!email || !full_name || !role || !password) {
      return json({ error: 'Preencha nome, email, cargo e senha' }, 400);
    }
    if (!VALID_ROLES.includes(role)) return json({ error: 'Cargo inválido' }, 400);
    if (String(password).length < 6) return json({ error: 'Senha deve ter pelo menos 6 caracteres' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE);

    const { data: inviter, error: invErr } = await admin
      .from('profiles')
      .select('id, store_id, role')
      .eq('auth_user_id', inviterAuthId)
      .maybeSingle();
    if (invErr || !inviter) return json({ error: 'Perfil do solicitante não encontrado' }, 403);
    if (!['owner', 'admin', 'manager'].includes(inviter.role)) return json({ error: 'Sem permissão' }, 403);
    if (['owner', 'admin'].includes(role) && inviter.role !== 'owner') {
      return json({ error: 'Apenas o proprietário pode criar Proprietário/Administrador' }, 403);
    }

    // Try createUser directly
    let userId: string | null = null;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });

    if (createErr || !created?.user) {
      const msg = (createErr?.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
        // Find existing user
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 } as any);
        const existing = list?.users?.find((u: any) => (u.email || '').toLowerCase() === String(email).toLowerCase());
        if (existing) {
          userId = existing.id;
          // Update password
          await admin.auth.admin.updateUserById(existing.id, { password });
        } else {
          return json({ error: createErr?.message || 'E-mail já cadastrado' }, 400);
        }
      } else {
        return json({ error: createErr?.message || 'Falha ao criar usuário' }, 400);
      }
    } else {
      userId = created.user.id;
    }

    // Profile create/update
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, store_id')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (existingProfile) {
      if (existingProfile.store_id !== inviter.store_id) {
        return json({ error: 'Este e-mail já pertence a outra loja' }, 409);
      }
      await admin.from('profiles').update({ full_name, role, phone: phone || null, is_active: true }).eq('id', existingProfile.id);
    } else {
      const { error: profErr } = await admin.from('profiles').insert({
        auth_user_id: userId,
        store_id: inviter.store_id,
        full_name,
        role,
        phone: phone || null,
        is_active: true,
      });
      if (profErr) {
        await admin.auth.admin.deleteUser(userId!).catch(() => {});
        return json({ error: profErr.message }, 400);
      }
    }

    // Audit
    await admin.from('audit_logs').insert({
      store_id: inviter.store_id,
      actor_profile_id: inviter.id,
      action: 'employee_created',
      entity: 'profile',
      entity_id: userId,
      after_json: { email, full_name, role, phone: phone || null },
    });

    return json({ ok: true, user_id: userId, message: 'Funcionário criado. Já pode fazer login com email e senha.' });
  } catch (e: any) {
    console.error('[employees-invite] unexpected', e?.message);
    return json({ error: e?.message || 'Erro inesperado' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
