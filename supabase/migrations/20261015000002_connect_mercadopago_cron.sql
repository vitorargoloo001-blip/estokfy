-- =====================================================================
-- Estokfy Connect — Mercado Pago: sincronização periódica (rede de segurança)
--
-- A Dibacell recebe pela maquininha Point, Pix/QR do app e link de
-- pagamento — nenhum desses passa pela aplicação "Estokfy Connect", e a
-- documentação do Mercado Pago não garante que o webhook do tópico
-- `payment` de uma aplicação notifique pagamentos criados fora dela. Por
-- isso, além do webhook, o pg_cron chama mercadopago-sync-payments a cada
-- 10 minutos (busca incremental por date_last_updated — idempotente).
--
-- Requer as extensões pg_net e supabase_vault (conferir em
-- pg_available_extensions antes de aplicar). Ficou numa migration
-- separada de propósito: a 20261015000001 não depende desta.
--
-- O segredo que autentica o cron na Edge Function é gerado aqui mesmo e
-- guardado no Vault — nunca aparece em código, chat ou env var. A Edge
-- Function confere o header via mercadopago_cron_secret_matches().
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'mercadopago_cron_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'mercadopago_cron_secret',
      'Autentica o pg_cron na Edge Function mercadopago-sync-payments'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mercadopago_cron_secret_matches(p_secret TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected TEXT;
BEGIN
  IF p_secret IS NULL OR length(p_secret) < 32 THEN
    RETURN false;
  END IF;

  SELECT ds.decrypted_secret INTO v_expected
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'mercadopago_cron_secret';

  RETURN v_expected IS NOT NULL AND v_expected = p_secret;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mercadopago_cron_secret_matches(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mercadopago_cron_secret_matches(TEXT) TO service_role;

-- cron.schedule com um nome já existente substitui o job (pg_cron >= 1.4).
SELECT cron.schedule(
  'mercadopago-sync',
  '*/10 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://aimasistzxghumuxxuaw.supabase.co/functions/v1/mercadopago-sync-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = 'mercadopago_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
