-- =====================================================================
-- FIX: refresh_store_notifications falhava 100% das vezes (42P10)
--      + agregação por tipo para o volume ficar utilizável
--
-- CAUSA RAIZ
-- O índice de dedupe é PARCIAL:
--   CREATE UNIQUE INDEX uq_notifications_dedupe
--     ON public.notifications (store_id, dedupe_key)
--     WHERE dedupe_key IS NOT NULL;
-- O Postgres só infere um índice único parcial no ON CONFLICT se a
-- cláusula repetir o predicado do índice. A função usava
--   ON CONFLICT (store_id, dedupe_key) DO NOTHING
-- sem o WHERE, então nenhum índice casava e todo INSERT abortava com
-- "42P10: there is no unique or exclusion constraint matching the
-- ON CONFLICT specification" — derrubando a RPC inteira com 400.
--
-- A unicidade É requisito de negócio (dedupe diário por
-- store_id+dedupe_key) e o índice já estava correto, inclusive por ser
-- parcial: as notificações vindas do trigger
-- trg_sales_alert_payment_reverted gravam dedupe_key NULL e não devem
-- participar do dedupe. Portanto não se cria constraint nova — corrige-se
-- a cláusula, que é onde estava o defeito.
--
-- IMPACTO ANTES
-- Zero notificações de stock_out, stock_low, payable_overdue e
-- receivable_overdue jamais foram criadas (verificado em produção: das
-- 430 notificações existentes, todas eram sale_payment_reverted). Os
-- quatro alertas estavam mortos desde 2026-04.
--
-- POR QUE AGREGAR
-- Só consertar o ON CONFLICT reativaria o desenho original — uma
-- notificação por produto e por venda — que nas lojas reais significa
-- ~8.900 linhas POR DIA (5.585 numa loja, 3.213 em outra), já que o
-- dedupe_key inclui a data. O sino nasceria inutilizável e a tabela
-- cresceria ~270k linhas/mês. Passa a ser uma notificação por tipo, por
-- loja, por dia, carregando a contagem — mesmo formato que o Dashboard
-- já usa nos toasts. O clique leva para a tela que lista os itens.
--
-- ON CONFLICT ... DO UPDATE (e não DO NOTHING) para a contagem
-- acompanhar o dia: se de manhã havia 10 produtos sem estoque e à tarde
-- 50, o texto é atualizado em vez de congelar no número da manhã.
-- read_at é deliberadamente preservado — reabrir algo que a pessoa já
-- leu seria ruído.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.refresh_store_notifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx record;
  v_store uuid;
  v_today text := to_char(now(), 'YYYY-MM-DD');
  v_stock_out int;
  v_stock_low int;
  v_payable int;
  v_payable_amount numeric;
  v_recv int;
  v_recv_amount numeric;
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();
  v_store := v_ctx.store_id;

  SELECT count(*) INTO v_stock_out
    FROM public.products p
   WHERE p.store_id = v_store AND p.is_active = true AND p.on_hand <= 0;

  SELECT count(*) INTO v_stock_low
    FROM public.products p
   WHERE p.store_id = v_store AND p.is_active = true
     AND p.on_hand > 0 AND p.minimum_stock > 0 AND p.on_hand <= p.minimum_stock;

  SELECT count(*), coalesce(sum(ap.amount), 0) INTO v_payable, v_payable_amount
    FROM public.accounts_payable ap
   WHERE ap.store_id = v_store AND ap.status = 'pending' AND ap.due_date < current_date;

  SELECT count(*), coalesce(sum(s.amount_pending), 0) INTO v_recv, v_recv_amount
    FROM public.sales s
   WHERE s.store_id = v_store
     AND s.payment_status IN ('pending','partial')
     AND s.due_date IS NOT NULL AND s.due_date < current_date;

  IF v_stock_out > 0 THEN
    INSERT INTO public.notifications(store_id, type, severity, title, description, link, dedupe_key)
    VALUES (v_store, 'stock_out', 'critical',
            v_stock_out || ' produto(s) sem estoque',
            'Produtos ativos com estoque zerado. Abra a lista para ver quais.',
            '/produtos', 'stock_out:' || v_today)
    ON CONFLICT (store_id, dedupe_key) WHERE dedupe_key IS NOT NULL
    DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description;
  END IF;

  IF v_stock_low > 0 THEN
    INSERT INTO public.notifications(store_id, type, severity, title, description, link, dedupe_key)
    VALUES (v_store, 'stock_low', 'warning',
            v_stock_low || ' produto(s) com estoque baixo',
            'Produtos ativos no mínimo ou abaixo dele.',
            '/produtos', 'stock_low:' || v_today)
    ON CONFLICT (store_id, dedupe_key) WHERE dedupe_key IS NOT NULL
    DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description;
  END IF;

  IF v_payable > 0 THEN
    INSERT INTO public.notifications(store_id, type, severity, title, description, link, dedupe_key)
    VALUES (v_store, 'payable_overdue', 'critical',
            v_payable || ' conta(s) a pagar vencida(s)',
            'Total vencido: R$ ' || to_char(v_payable_amount, 'FM999G999G990D00') || '.',
            '/contas-a-pagar', 'payable_overdue:' || v_today)
    ON CONFLICT (store_id, dedupe_key) WHERE dedupe_key IS NOT NULL
    DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description;
  END IF;

  IF v_recv > 0 THEN
    INSERT INTO public.notifications(store_id, type, severity, title, description, link, dedupe_key)
    VALUES (v_store, 'receivable_overdue', 'warning',
            v_recv || ' venda(s) vencida(s) a receber',
            'Total pendente: R$ ' || to_char(v_recv_amount, 'FM999G999G990D00') || '.',
            '/contas-a-receber', 'recv_overdue:' || v_today)
    ON CONFLICT (store_id, dedupe_key) WHERE dedupe_key IS NOT NULL
    DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'stock_out', v_stock_out,
    'stock_low', v_stock_low,
    'payable_overdue', v_payable,
    'receivable_overdue', v_recv
  );
END;
$function$;

-- NOTA DELIBERADA — por que NÃO existe notificação fiscal aqui.
-- A policy de SELECT de public.notifications é apenas
-- "store_id = get_my_store_id()", sem recorte por papel: qualquer papel da
-- loja, vendedor incluído, lê todas as notificações. Criar aqui um alerta
-- do tipo "N notas pendentes de declaração" exporia o quadro fiscal da
-- empresa ao vendedor, quebrando a regra do módulo Fiscal. O alerta fiscal
-- fica no Dashboard (card "Notas a Declarar" + toast), que já é restrito:
-- get_fiscal_summary recusa o papel 'sales' e o Dashboard financeiro nem
-- é renderizado para ele.
