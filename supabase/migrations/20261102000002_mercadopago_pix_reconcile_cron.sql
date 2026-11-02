-- =====================================================================
-- Conciliação periódica das cobranças Pix (Mercado Pago, Orders API).
--
-- A quitação de uma cobrança Pix dependia da tela do Pix estar aberta (ela
-- consulta a cada 5 s) ou do aviso do webhook. Se a vendedora fechava a tela
-- antes do pagamento, a venda ficava pendente mesmo com o dinheiro recebido.
--
-- Este job chama a Edge Function mercadopago-pix-reconcile de 5 em 5 minutos.
-- A função consulta no Mercado Pago cada cobrança ainda aberta (da mais antiga
-- para a mais nova) e aplica o status pelo mesmo caminho do webhook
-- (mercadopago_pix_apply_status, idempotente). Cobrança expirada no Mercado
-- Pago vira "expired" e sai da fila sozinha.
--
-- Requer o segredo mercadopago_cron_secret no Vault (migration 20261015000002).
-- Não altera nenhuma tabela nem função existente.
-- =====================================================================

-- cron.schedule com um nome já existente substitui o job (pg_cron >= 1.4).
SELECT cron.schedule(
  'mercadopago-pix-reconcile',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://aimasistzxghumuxxuaw.supabase.co/functions/v1/mercadopago-pix-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = 'mercadopago_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
