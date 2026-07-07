-- =====================================================================
-- Feature: conectar o Itaú diretamente (API PIX Recebimentos), sem
-- agregador terceiro, configurável 100% pela tela de Conexões — sem
-- precisar de mim/CLI para configurar nada no Supabase depois da primeira
-- publicação desta migration + da Edge Function.
--
-- Por quê não usar "secrets" do Supabase por loja: secrets de Edge Function
-- são globais ao projeto (compartilhados por TODAS as lojas do Estokfy), e
-- só podem ser definidos via Management API com um token de acesso pessoal
-- de nível de projeto — dar isso pro frontend seria dar controle de infra
-- pra qualquer dono de loja. Em vez disso, cada conexão Itaú tem seu próprio
-- webhook_secret gerado no banco (RLS já isola por loja), e o Itaú aponta
-- pra URL `.../itau-pix-webhook?token=<esse secret>` — o Edge Function
-- descobre a loja/conexão pelo próprio token, sem env var nenhuma.
-- =====================================================================

ALTER TABLE public.bank_connections
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT UNIQUE;

-- ── Criar conexão Itaú direta ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_itau_direct_connection(
  p_store_id UUID,
  p_account_number TEXT,
  p_account_type TEXT,
  p_agency TEXT DEFAULT NULL
) RETURNS TABLE(id UUID, webhook_secret TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_secret TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.store_id = p_store_id
      AND p.role IN ('owner','admin','manager')
  ) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;

  IF p_account_number IS NULL OR length(btrim(p_account_number)) = 0 THEN
    RAISE EXCEPTION 'numero_conta_obrigatorio';
  END IF;
  IF p_account_type NOT IN ('checking','savings','other') THEN
    RAISE EXCEPTION 'tipo_conta_invalido';
  END IF;

  v_secret := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.bank_connections (
    store_id, bank_name, account_number, account_type, agency,
    status, provider, is_active, webhook_secret
  ) VALUES (
    p_store_id, 'Itaú', btrim(p_account_number), p_account_type, p_agency,
    'connected', 'itau_direct', true, v_secret
  ) RETURNING bank_connections.id INTO v_id;

  RETURN QUERY SELECT v_id, v_secret;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_itau_direct_connection(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ── Consultar a URL/token do webhook de uma conexão Itaú direta ────────
CREATE OR REPLACE FUNCTION public.get_itau_webhook_secret(p_bank_connection_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT bc.webhook_secret INTO v_secret
  FROM public.bank_connections bc
  WHERE bc.id = p_bank_connection_id
    AND bc.provider = 'itau_direct'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.store_id = bc.store_id
        AND p.role IN ('owner','admin','manager')
    );
  RETURN v_secret;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_itau_webhook_secret(UUID) TO authenticated;

-- ── Rotacionar o token (em caso de suspeita de vazamento) ──────────────
CREATE OR REPLACE FUNCTION public.regenerate_itau_webhook_secret(p_bank_connection_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id UUID;
  v_secret TEXT;
BEGIN
  SELECT bc.store_id INTO v_store_id
  FROM public.bank_connections bc
  WHERE bc.id = p_bank_connection_id AND bc.provider = 'itau_direct';

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'conexao_invalida';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.store_id = v_store_id
      AND p.role IN ('owner','admin')
  ) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;

  v_secret := encode(gen_random_bytes(24), 'hex');

  UPDATE public.bank_connections
     SET webhook_secret = v_secret, updated_at = now()
   WHERE id = p_bank_connection_id;

  RETURN v_secret;
END;
$$;

GRANT EXECUTE ON FUNCTION public.regenerate_itau_webhook_secret(UUID) TO authenticated;
