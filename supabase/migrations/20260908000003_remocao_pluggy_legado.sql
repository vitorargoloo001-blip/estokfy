-- =====================================================================
-- REMOÇÃO DO CLUSTER PLUGGY LEGADO
-- Ver PLUGGY-LEGADO-MAPEAMENTO-2026-09.md para a evidência completa de
-- que nada ativo depende destes objetos (0 chamadores em qualquer
-- camada, 0 linhas de dado). NÃO APLICADO.
--
-- Não remove nada da integração Connect ATUAL (pluggy-connect-token,
-- pluggy-register-item, pluggy-webhook, pluggy-sync-transactions,
-- pluggy-config-status e as RPCs de 20260621000001_connect_pluggy_v2.sql
-- ficam intactas). Não remove PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET —
-- compartilhados com o cluster vivo.
-- =====================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.update_or_insert_bank_connection(uuid, text, text, text, timestamp with time zone, text, text, text, text);
DROP FUNCTION IF EXISTS public.get_bank_connection_token(uuid, uuid);
DROP FUNCTION IF EXISTS public.sync_bank_accounts_from_provider(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.sync_bank_transactions_from_provider(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.store_provider_webhook(uuid, uuid, text, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.update_bank_connection_sync(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_bank_connection_with_provider(uuid);
DROP FUNCTION IF EXISTS public.list_webhook_events(uuid, uuid, text, boolean, integer, integer);
DROP FUNCTION IF EXISTS public.mark_webhook_processed(uuid, boolean, text);

-- 0 linhas confirmadas em produção antes de aplicar (ver mapeamento).
DROP TABLE IF EXISTS public.provider_webhooks;

COMMIT;

-- Verificação pós-aplicação (deve retornar 0 linhas):
-- SELECT proname FROM pg_proc WHERE proname IN (
--   'update_or_insert_bank_connection','get_bank_connection_token',
--   'sync_bank_accounts_from_provider','sync_bank_transactions_from_provider',
--   'store_provider_webhook','update_bank_connection_sync',
--   'get_bank_connection_with_provider','list_webhook_events','mark_webhook_processed'
-- );
-- SELECT to_regclass('public.provider_webhooks'); -- deve retornar NULL

-- Lado do código (fora do banco, ação separada): apagar as 6 pastas:
--   supabase/functions/connect-bank-oauth/
--   supabase/functions/connect-pluggy-auth-callback/
--   supabase/functions/sync-bank-accounts/
--   supabase/functions/sync-bank-transactions/
--   supabase/functions/refresh-bank-connection/
--   supabase/functions/run-bank-reconciliation/
--   supabase/functions/connect-process-events/  (worker órfão relacionado,
--     lê de webhook_events que nem existe no banco)
