-- =====================================================================
-- Fix: _connect_run_matching_core (criada na migration anterior para ser
-- chamada só pelo cron/serviço, sem check de auth.uid()) foi criada sem
-- REVOKE explícito, então herdou o GRANT padrão do Postgres para PUBLIC —
-- na prática qualquer usuário autenticado (e até anon) conseguia chamar
-- connect_run_matching para o store_id de QUALQUER loja, pulando o check
-- de permissão que existe no wrapper público connect_run_matching.
--
-- Descoberto ao revisar quem poderia chamar essa função antes de reutilizá-la
-- na integração direta com o Itaú (Edge Function itau-pix-webhook).
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public._connect_run_matching_core(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public._connect_run_matching_core(UUID) TO service_role;
