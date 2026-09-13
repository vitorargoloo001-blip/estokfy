-- =====================================================================
-- FISCAL — pendência "a emitir" por venda
--
-- Objetivo: nenhuma venda passar batida por falta de nota, com registro
-- automático no sistema.
--
-- O QUE ESTE REGISTRO NÃO É: não é uma nota fiscal. Número, série e chave
-- de acesso são autorizados pela SEFAZ — o Estokfy não emite e não tem
-- como inventá-los. Gravar números fictícios encheria a relação que vai
-- para o contador de documentos inexistentes e colidiria com as notas
-- reais na hora de importar o XML. Por isso a pendência nasce SEM número
-- e SEM chave, num status próprio (`a_emitir`) que a distingue de uma
-- nota de verdade em qualquer relatório.
--
-- Quando a nota for realmente emitida, a pessoa preenche o número (ou
-- anexa o XML) e o mesmo registro vira a nota, já vinculada à venda.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Número deixa de ser obrigatório — pendência ainda não tem número
-- ---------------------------------------------------------------------
ALTER TABLE public.fiscal_documents ALTER COLUMN invoice_number DROP NOT NULL;

ALTER TABLE public.fiscal_documents DROP CONSTRAINT IF EXISTS fiscal_documents_fiscal_status_check;
ALTER TABLE public.fiscal_documents ADD CONSTRAINT fiscal_documents_fiscal_status_check
  CHECK (fiscal_status IN ('a_emitir','pending','sent_to_accountant','declared','cancelled'));

-- Só nota com número participa do anti-duplicidade. Pendências (número
-- nulo) nunca colidem entre si.
DROP INDEX IF EXISTS public.uq_fiscal_documents_number;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_documents_number
  ON public.fiscal_documents(store_id, document_type, direction, invoice_number, COALESCE(series,''))
  WHERE cancelled_at IS NULL AND invoice_number IS NOT NULL;

-- Uma pendência por venda — garante idempotência do gatilho e do backfill
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_documents_pendencia_venda
  ON public.fiscal_documents(sale_id)
  WHERE fiscal_status = 'a_emitir' AND sale_id IS NOT NULL;

-- Nota de verdade (qualquer status que não seja pendência) precisa de número
ALTER TABLE public.fiscal_documents DROP CONSTRAINT IF EXISTS fiscal_documents_numero_obrigatorio;
ALTER TABLE public.fiscal_documents ADD CONSTRAINT fiscal_documents_numero_obrigatorio
  CHECK (fiscal_status = 'a_emitir' OR invoice_number IS NOT NULL);

-- ---------------------------------------------------------------------
-- 2) Criação da pendência (usada pelo gatilho e pelo backfill)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._criar_pendencia_fiscal(p_sale_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_sale record; v_id uuid;
BEGIN
  SELECT s.id, s.store_id, s.customer_id, s.sale_date, s.net_total, s.created_by,
         c.name AS customer_name, c.doc_id AS customer_doc
    INTO v_sale
    FROM public.sales s
    LEFT JOIN public.customers c ON c.id = s.customer_id
   WHERE s.id = p_sale_id AND s.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.fiscal_documents(
    store_id, sale_id, customer_id, document_type, direction,
    invoice_number, issue_date, competence_month, competence_year,
    total_amount, counterpart_name, counterpart_doc, fiscal_status,
    notes, created_by
  ) VALUES (
    v_sale.store_id, v_sale.id, v_sale.customer_id, 'saida', 'outgoing',
    NULL, v_sale.sale_date,
    EXTRACT(MONTH FROM v_sale.sale_date)::int,
    EXTRACT(YEAR FROM v_sale.sale_date)::int,
    v_sale.net_total, v_sale.customer_name,
    nullif(regexp_replace(coalesce(v_sale.customer_doc,''), '[^0-9]', '', 'g'),''),
    'a_emitir',
    'Pendência gerada automaticamente a partir da venda. Não é nota fiscal: preencha o número quando emitir, ou anexe o XML.',
    v_sale.created_by
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._criar_pendencia_fiscal(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) Gatilho: toda venda nova ganha a pendência sozinha
--
-- O bloco EXCEPTION é deliberado e NÃO é descuido: registrar venda é o
-- caminho crítico da operação e acabou de ser desbloqueado depois de uma
-- vendedora ficar dias travada. Nenhuma falha do módulo fiscal pode
-- derrubar uma venda. Se a pendência não nascer, a tela "Vendas sem nota"
-- continua apontando a venda — a rede de segurança não depende do gatilho.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fiscal_pendencia_por_venda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NEW.deleted_at IS NULL AND coalesce(NEW.status,'') <> 'cancelled' THEN
      PERFORM public._criar_pendencia_fiscal(NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_fiscal_pendencia ON public.sales;
CREATE TRIGGER trg_sales_fiscal_pendencia
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_fiscal_pendencia_por_venda();

-- ---------------------------------------------------------------------
-- 4) Edição: pendência pode ser salva sem número; nota real, não
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_fiscal_document(
  p_id uuid, p_document_type text, p_direction text, p_invoice_number text,
  p_issue_date date, p_competence_month int, p_competence_year int,
  p_total_amount numeric, p_series text DEFAULT NULL, p_access_key text DEFAULT NULL,
  p_sale_id uuid DEFAULT NULL, p_customer_id uuid DEFAULT NULL, p_supplier_id uuid DEFAULT NULL,
  p_counterpart_name text DEFAULT NULL, p_counterpart_doc text DEFAULT NULL,
  p_xml_path text DEFAULT NULL, p_pdf_path text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.fiscal_documents%ROWTYPE;
  v_profile_id uuid; v_key text; v_before jsonb; v_numero text;
BEGIN
  SELECT * INTO v_row FROM public.fiscal_documents WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'documento_nao_encontrado'; END IF;

  PERFORM public._assert_fiscal_manage(v_row.store_id);
  SELECT id INTO v_profile_id FROM public.profiles
   WHERE auth_user_id = auth.uid() AND store_id = v_row.store_id;

  IF v_row.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'documento_cancelado'; END IF;

  v_numero := nullif(btrim(coalesce(p_invoice_number,'')),'');
  -- pendência continua podendo ficar sem número; nota real exige
  IF v_numero IS NULL AND v_row.fiscal_status <> 'a_emitir' THEN
    RAISE EXCEPTION 'numero_nota_obrigatorio';
  END IF;
  IF p_total_amount IS NULL OR p_total_amount < 0 THEN RAISE EXCEPTION 'valor_invalido'; END IF;
  IF p_competence_month IS NULL OR p_competence_month NOT BETWEEN 1 AND 12
     OR p_competence_year IS NULL OR p_competence_year NOT BETWEEN 2000 AND 2100 THEN
    RAISE EXCEPTION 'competencia_invalida';
  END IF;

  v_key := nullif(regexp_replace(coalesce(p_access_key,''), '[^0-9]', '', 'g'), '');
  IF v_key IS NOT NULL AND length(v_key) <> 44 THEN RAISE EXCEPTION 'chave_acesso_invalida'; END IF;

  IF p_sale_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales s WHERE s.id = p_sale_id AND s.store_id = v_row.store_id
  ) THEN RAISE EXCEPTION 'venda_invalida'; END IF;
  IF p_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id = p_customer_id AND c.store_id = v_row.store_id
  ) THEN RAISE EXCEPTION 'cliente_invalido'; END IF;
  IF p_supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers f WHERE f.id = p_supplier_id AND f.store_id = v_row.store_id
  ) THEN RAISE EXCEPTION 'fornecedor_invalido'; END IF;

  v_before := to_jsonb(v_row);

  BEGIN
    UPDATE public.fiscal_documents SET
      document_type = p_document_type, direction = p_direction,
      invoice_number = v_numero,
      series = nullif(btrim(coalesce(p_series,'')),''),
      access_key = v_key, issue_date = p_issue_date,
      competence_month = p_competence_month, competence_year = p_competence_year,
      total_amount = round(p_total_amount, 2),
      sale_id = p_sale_id, customer_id = p_customer_id, supplier_id = p_supplier_id,
      counterpart_name = nullif(btrim(coalesce(p_counterpart_name,'')),''),
      counterpart_doc = nullif(regexp_replace(coalesce(p_counterpart_doc,''), '[^0-9]', '', 'g'),''),
      xml_path = nullif(btrim(coalesce(p_xml_path,'')),''),
      pdf_path = nullif(btrim(coalesce(p_pdf_path,'')),''),
      notes = nullif(btrim(coalesce(p_notes,'')),''),
      -- informar o número promove a pendência a nota pendente de declaração
      fiscal_status = CASE WHEN v_row.fiscal_status = 'a_emitir' AND v_numero IS NOT NULL
                           THEN 'pending' ELSE v_row.fiscal_status END,
      updated_at = now()
     WHERE id = p_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'nota_duplicada';
  END;

  SELECT * INTO v_row FROM public.fiscal_documents WHERE id = p_id;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
  VALUES (v_row.store_id, v_profile_id, 'update', 'fiscal_document', p_id, v_before,
          to_jsonb(v_row) || jsonb_build_object('motivo', nullif(btrim(coalesce(p_reason,'')),'')));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_fiscal_document(uuid, text, text, text, date, int, int, numeric, text, text, uuid, uuid, uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_fiscal_document(uuid, text, text, text, date, int, int, numeric, text, text, uuid, uuid, uuid, text, text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 5) Transição de status não deixa pendência virar nota sem número
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_fiscal_document_status(
  p_id uuid, p_status text, p_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.fiscal_documents%ROWTYPE; v_profile_id uuid; v_before jsonb;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('a_emitir','pending','sent_to_accountant','declared','cancelled') THEN
    RAISE EXCEPTION 'status_invalido';
  END IF;

  SELECT * INTO v_row FROM public.fiscal_documents WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'documento_nao_encontrado'; END IF;

  PERFORM public._assert_fiscal_manage(v_row.store_id);
  SELECT id INTO v_profile_id FROM public.profiles
   WHERE auth_user_id = auth.uid() AND store_id = v_row.store_id;

  IF v_row.fiscal_status = p_status THEN RETURN; END IF;

  -- sair de "a emitir" só com número informado (exceto cancelar)
  IF v_row.fiscal_status = 'a_emitir' AND p_status NOT IN ('cancelled','a_emitir')
     AND v_row.invoice_number IS NULL THEN
    RAISE EXCEPTION 'numero_nota_obrigatorio';
  END IF;

  v_before := to_jsonb(v_row);

  UPDATE public.fiscal_documents SET
    fiscal_status = p_status,
    sent_to_accountant_at = CASE WHEN p_status = 'sent_to_accountant' THEN now()
                                 WHEN p_status IN ('pending','a_emitir') THEN NULL
                                 ELSE sent_to_accountant_at END,
    sent_to_accountant_by = CASE WHEN p_status = 'sent_to_accountant' THEN v_profile_id
                                 WHEN p_status IN ('pending','a_emitir') THEN NULL
                                 ELSE sent_to_accountant_by END,
    declared_at = CASE WHEN p_status = 'declared' THEN now()
                       WHEN p_status IN ('pending','sent_to_accountant','a_emitir') THEN NULL
                       ELSE declared_at END,
    declared_by = CASE WHEN p_status = 'declared' THEN v_profile_id
                       WHEN p_status IN ('pending','sent_to_accountant','a_emitir') THEN NULL
                       ELSE declared_by END,
    cancelled_at = CASE WHEN p_status = 'cancelled' THEN now() ELSE NULL END,
    cancelled_by = CASE WHEN p_status = 'cancelled' THEN v_profile_id ELSE NULL END,
    notes = COALESCE(nullif(btrim(coalesce(p_notes,'')),''), notes),
    updated_at = now()
   WHERE id = p_id;

  SELECT * INTO v_row FROM public.fiscal_documents WHERE id = p_id;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
  VALUES (v_row.store_id, v_profile_id, 'status_change', 'fiscal_document', p_id,
          jsonb_build_object('fiscal_status', v_before->>'fiscal_status'),
          jsonb_build_object('fiscal_status', p_status,
                             'motivo', nullif(btrim(coalesce(p_notes,'')),'')));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_fiscal_document_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_fiscal_document_status(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 6) Resumo passa a contar as pendências separadamente
--
-- DROP antes do CREATE porque CREATE OR REPLACE não altera a forma do
-- RETURNS TABLE (42P13). Derrubar a assinatura antiga no mesmo arquivo
-- também evita deixar duas versões vivas — o footgun de overload que já
-- causou bug neste projeto duas vezes.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_fiscal_summary(uuid, int, int);

CREATE OR REPLACE FUNCTION public.get_fiscal_summary(
  p_store_id uuid, p_year int DEFAULT NULL, p_month int DEFAULT NULL
) RETURNS TABLE (
  pending_count bigint, sent_count bigint, declared_count bigint,
  cancelled_count bigint, period_count bigint, pending_amount numeric,
  overdue_count bigint, alert_days int, to_issue_count bigint, to_issue_amount numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_raw text; v_alert_days int := 15;
BEGIN
  PERFORM public._assert_fiscal_manage(p_store_id);

  SELECT btrim(ss.settings->>'alert_days') INTO v_raw
    FROM public.store_settings ss
   WHERE ss.store_id = p_store_id AND ss.category = 'fiscal';
  IF v_raw ~ '^[0-9]+$' AND v_raw::numeric BETWEEN 1 AND 3650 THEN
    v_alert_days := v_raw::int;
  END IF;

  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE fd.fiscal_status = 'pending'),
    count(*) FILTER (WHERE fd.fiscal_status = 'sent_to_accountant'),
    count(*) FILTER (WHERE fd.fiscal_status = 'declared'),
    count(*) FILTER (WHERE fd.fiscal_status = 'cancelled'),
    count(*) FILTER (
      WHERE (p_year IS NULL OR fd.competence_year = p_year)
        AND (p_month IS NULL OR fd.competence_month = p_month)
    ),
    COALESCE(sum(fd.total_amount) FILTER (WHERE fd.fiscal_status = 'pending'), 0)::numeric,
    count(*) FILTER (
      WHERE fd.fiscal_status = 'pending' AND fd.issue_date < (current_date - v_alert_days)
    ),
    v_alert_days,
    count(*) FILTER (WHERE fd.fiscal_status = 'a_emitir'),
    COALESCE(sum(fd.total_amount) FILTER (WHERE fd.fiscal_status = 'a_emitir'), 0)::numeric
  FROM public.fiscal_documents fd
  WHERE fd.store_id = p_store_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_fiscal_summary(uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fiscal_summary(uuid, int, int) TO authenticated;
