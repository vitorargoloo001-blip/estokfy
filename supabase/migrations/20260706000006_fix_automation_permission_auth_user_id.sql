-- =====================================================================
-- Fix: _has_automation_permission() comparava profiles.id = auth.uid(),
-- mas profiles.id é a PK própria da tabela — o vínculo com o usuário
-- autenticado é profiles.auth_user_id. Isso fazia a checagem retornar
-- sempre falso para QUALQUER usuário (inclusive owner), tornando
-- impossível criar/editar/ativar/excluir/aprovar automações desde o
-- lançamento do Block 7 (20260622000030). Confirma-se pela tabela
-- connect_automations estar vazia em produção.
-- =====================================================================

CREATE OR REPLACE FUNCTION public._has_automation_permission(p_store_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid()
      AND store_id = p_store_id
      AND role = ANY(ARRAY['owner','admin','manager','finance'])
  );
$$;
