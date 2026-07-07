-- =====================================================================
-- Fix: create_itau_direct_connection e regenerate_itau_webhook_secret
-- usavam gen_random_bytes() (extensão pgcrypto), que não está habilitada
-- neste projeto (só pg_trgm e, desde a migration anterior, pg_cron).
-- Troca para gen_random_uuid(), já usado em toda a base sem extensão extra.
-- =====================================================================

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

  v_secret := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

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

  v_secret := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  UPDATE public.bank_connections
     SET webhook_secret = v_secret, updated_at = now()
   WHERE id = p_bank_connection_id;

  RETURN v_secret;
END;
$$;
