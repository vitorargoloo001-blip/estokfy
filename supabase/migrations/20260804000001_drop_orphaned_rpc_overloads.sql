-- =====================================================================
-- Limpeza de overloads órfãos (mesmo padrão de bug documentado no
-- CLAUDE.md: CREATE OR REPLACE com assinatura diferente cria uma função
-- nova em vez de substituir a antiga).
--
-- Confirmado via grep de todos os call sites (.rpc(...)) no frontend +
-- edge functions: nenhuma chamada real usa estas assinaturas antigas —
-- todas usam as versões mais novas listadas abaixo.
-- =====================================================================

-- settle_sale_payment: só a versão com p_note (4 params) é chamada
-- (sales-settle-payment/index.ts sempre passa os 4 nomeados).
DROP FUNCTION IF EXISTS public.settle_sale_payment(uuid, jsonb, timestamp with time zone);

-- get_reconciliation_by_method: só a versão (uuid, date, date) é chamada
-- (ConnectOverview.tsx e ConnectReports.tsx usam p_start_date/p_end_date).
DROP FUNCTION IF EXISTS public.get_reconciliation_by_method(uuid, integer);

-- resolve_product_ids_by_filter: só a versão (uuid, text, uuid, text, text, text)
-- é chamada (BulkEditProductsDialog.tsx usa p_store_id + p_status).
DROP FUNCTION IF EXISTS public.resolve_product_ids_by_filter(text, uuid, text, text, integer, integer);
