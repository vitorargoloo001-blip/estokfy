
create or replace function public.current_profile()
returns table(profile_id uuid, store_id uuid, role text, is_active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.store_id, p.role, p.is_active
  from public.profiles p
  where p.auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.require_active_profile()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v record;
begin
  select * into v from public.current_profile();
  if v.profile_id is null then
    raise exception 'perfil_nao_encontrado';
  end if;
  if v.is_active is not true then
    raise exception 'usuario_inativo';
  end if;
end;
$$;
