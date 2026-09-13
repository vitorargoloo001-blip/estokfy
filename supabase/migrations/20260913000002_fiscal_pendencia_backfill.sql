-- =====================================================================
-- FISCAL — backfill das pendências "a emitir" (setembro/2026 em diante)
--
-- Corte em 2026-09-01 a pedido do dono: meses anteriores o contador já
-- fechou, e enchê-los de pendência só geraria ruído. Vendas anteriores
-- continuam visíveis pela tela "Vendas sem nota", que é derivada e não
-- depende deste backfill.
--
-- Idempotente: reexecutar não duplica, tanto pelo NOT EXISTS quanto pelo
-- índice único uq_fiscal_documents_pendencia_venda. Nenhuma linha de
-- sales/payments/cash_entries/stock_movements é tocada — só inserção em
-- fiscal_documents.
-- =====================================================================

DO $$
DECLARE
  v_antes bigint;
  v_criadas bigint;
  v_restantes bigint;
BEGIN
  SELECT count(*) INTO v_antes FROM public.fiscal_documents WHERE fiscal_status = 'a_emitir';

  INSERT INTO public.fiscal_documents(
    store_id, sale_id, customer_id, document_type, direction,
    invoice_number, issue_date, competence_month, competence_year,
    total_amount, counterpart_name, counterpart_doc, fiscal_status, notes, created_by
  )
  SELECT
    s.store_id, s.id, s.customer_id, 'saida', 'outgoing',
    NULL, s.sale_date,
    EXTRACT(MONTH FROM s.sale_date)::int,
    EXTRACT(YEAR FROM s.sale_date)::int,
    s.net_total, c.name,
    nullif(regexp_replace(coalesce(c.doc_id,''), '[^0-9]', '', 'g'),''),
    'a_emitir',
    'Pendência gerada automaticamente a partir da venda. Não é nota fiscal: preencha o número quando emitir, ou anexe o XML.',
    s.created_by
  FROM public.sales s
  LEFT JOIN public.customers c ON c.id = s.customer_id
  WHERE s.deleted_at IS NULL
    AND coalesce(s.status,'') <> 'cancelled'
    AND s.sale_date >= DATE '2026-09-01'
    AND NOT EXISTS (
      SELECT 1 FROM public.fiscal_documents fd
       WHERE fd.sale_id = s.id AND fd.fiscal_status <> 'cancelled'
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_criadas = ROW_COUNT;

  -- trilha por loja
  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  SELECT fd.store_id, NULL, 'backfill_pendencia_fiscal', 'fiscal_document', NULL,
         jsonb_build_object('pendencias_criadas', count(*), 'corte', '2026-09-01')
    FROM public.fiscal_documents fd
   WHERE fd.fiscal_status = 'a_emitir'
   GROUP BY fd.store_id;

  -- trava: nenhuma venda de setembro em diante pode sobrar sem documento
  SELECT count(*) INTO v_restantes
    FROM public.sales s
   WHERE s.deleted_at IS NULL
     AND coalesce(s.status,'') <> 'cancelled'
     AND s.sale_date >= DATE '2026-09-01'
     AND NOT EXISTS (
       SELECT 1 FROM public.fiscal_documents fd
        WHERE fd.sale_id = s.id AND fd.fiscal_status <> 'cancelled'
     );

  IF v_restantes > 0 THEN
    RAISE EXCEPTION 'Backfill incompleto: % venda(s) sem documento fiscal — abortando.', v_restantes;
  END IF;

  RAISE NOTICE 'Pendencias antes=% criadas=% restantes=%', v_antes, v_criadas, v_restantes;
END $$;
