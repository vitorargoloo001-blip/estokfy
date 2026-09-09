-- =====================================================================
-- MÓDULO FISCAL — controle de notas fiscais para declaração
--
-- Objetivo: registrar, organizar e acompanhar as notas fiscais que a
-- empresa precisa entregar ao contador. NÃO emite nota, NÃO declara,
-- NÃO presume prazo legal — é um controle documental.
--
-- INVARIANTE DE PROJETO (requisito explícito): lançar/editar/cancelar
-- uma nota fiscal NUNCA pode criar venda, mexer em estoque, gerar
-- recebimento ou lançar caixa. Por isso as RPCs abaixo escrevem
-- exclusivamente em `fiscal_documents` e `audit_logs` — nenhuma delas
-- referencia sales/stock_movements/cash_entries/payments em escrita.
--
-- SEGURANÇA: seguindo a convenção pós-auditoria 2026-09, toda função
-- SECURITY DEFINER usa LANGUAGE plpgsql com PERFORM de guard ANTES de
-- qualquer leitura (nunca o padrão `WITH guard AS MATERIALIZED` em
-- LANGUAGE sql, que comprovadamente não executa o guard quando o
-- relation do lado real volta vazio) e termina com REVOKE de
-- anon/PUBLIC + GRANT explícito para authenticated.
--
-- A tabela tem policy de SELECT apenas. Não existe policy de
-- INSERT/UPDATE/DELETE: toda escrita passa obrigatoriamente pelas RPCs
-- auditadas, então o browser não consegue gravar direto na tabela nem
-- forjar as colunas de autoria (created_by, declared_by, etc.).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tabela
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fiscal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,

  -- vínculos opcionais (nota pode existir sem venda: compra, despesa, serviço)
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,

  document_type text NOT NULL CHECK (document_type IN ('nfe','nfce','nfse','entrada','saida','outro')),
  direction text NOT NULL CHECK (direction IN ('incoming','outgoing')),

  invoice_number text NOT NULL,
  series text,
  access_key text CHECK (access_key IS NULL OR access_key ~ '^[0-9]{44}$'),

  issue_date date NOT NULL,
  competence_month int NOT NULL CHECK (competence_month BETWEEN 1 AND 12),
  competence_year int NOT NULL CHECK (competence_year BETWEEN 2000 AND 2100),

  total_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),

  -- contraparte livre, usada quando não há customer/supplier cadastrado
  counterpart_name text,
  counterpart_doc text,

  fiscal_status text NOT NULL DEFAULT 'pending'
    CHECK (fiscal_status IN ('pending','sent_to_accountant','declared','cancelled')),

  xml_path text,
  pdf_path text,
  notes text,

  sent_to_accountant_at timestamptz,
  sent_to_accountant_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  declared_at timestamptz,
  declared_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_store_competence
  ON public.fiscal_documents(store_id, competence_year DESC, competence_month DESC);
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_store_status
  ON public.fiscal_documents(store_id, fiscal_status) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_store_issue
  ON public.fiscal_documents(store_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_sale
  ON public.fiscal_documents(sale_id) WHERE sale_id IS NOT NULL;

-- Anti-duplicidade: o ponto do módulo é não perder nem repetir nota.
-- A chave de acesso é única por natureza; o par número+série também,
-- dentro do mesmo tipo/direção. Notas canceladas saem do índice para
-- permitir relançar corretamente depois de um cancelamento.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_documents_access_key
  ON public.fiscal_documents(store_id, access_key)
  WHERE access_key IS NOT NULL AND cancelled_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_documents_number
  ON public.fiscal_documents(store_id, document_type, direction, invoice_number, COALESCE(series,''))
  WHERE cancelled_at IS NULL;

-- ---------------------------------------------------------------------
-- 2) RLS — somente leitura; escrita exclusivamente via RPC
-- ---------------------------------------------------------------------
ALTER TABLE public.fiscal_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fiscal_documents_select ON public.fiscal_documents;
CREATE POLICY fiscal_documents_select ON public.fiscal_documents
  FOR SELECT TO authenticated
  USING (
    store_id = public.get_my_store_id()
    AND (
      public.get_my_role() IN ('owner','admin','manager','finance')
      -- vendedor enxerga apenas notas ligadas às vendas que ele mesmo criou
      OR (
        public.get_my_role() = 'sales'
        AND fiscal_documents.sale_id IS NOT NULL
        AND EXISTS (
          SELECT 1
            FROM public.sales s
            JOIN public.profiles p ON p.id = s.created_by
           WHERE s.id = fiscal_documents.sale_id
             AND p.auth_user_id = auth.uid()
        )
      )
    )
  );

-- ---------------------------------------------------------------------
-- 3) Storage privado para XML / PDF / DANFE / comprovantes
--    Convenção de path: <store_id>/<timestamp>-<rand>.<ext>
--    (mesma do bucket purchase-receipts)
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fiscal-documents', 'fiscal-documents', false, 10485760,
  ARRAY['application/xml','text/xml','application/pdf','image/png','image/jpeg','image/jpg']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "fiscal_documents_storage_select" ON storage.objects;
CREATE POLICY "fiscal_documents_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'fiscal-documents'
    AND (storage.foldername(name))[1] = public.get_my_store_id()::text
    AND public.get_my_role() = ANY (ARRAY['owner','admin','manager','finance'])
  );

DROP POLICY IF EXISTS "fiscal_documents_storage_insert" ON storage.objects;
CREATE POLICY "fiscal_documents_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'fiscal-documents'
    AND (storage.foldername(name))[1] = public.get_my_store_id()::text
    AND public.get_my_role() = ANY (ARRAY['owner','admin','manager','finance'])
  );

DROP POLICY IF EXISTS "fiscal_documents_storage_update" ON storage.objects;
CREATE POLICY "fiscal_documents_storage_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'fiscal-documents'
    AND (storage.foldername(name))[1] = public.get_my_store_id()::text
    AND public.get_my_role() = ANY (ARRAY['owner','admin','manager','finance'])
  );

DROP POLICY IF EXISTS "fiscal_documents_storage_delete" ON storage.objects;
CREATE POLICY "fiscal_documents_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'fiscal-documents'
    AND (storage.foldername(name))[1] = public.get_my_store_id()::text
    AND public.get_my_role() = ANY (ARRAY['owner','admin'])
  );

-- ---------------------------------------------------------------------
-- 4) Guard de papel do módulo fiscal
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_fiscal_manage(p_store_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role text;
BEGIN
  PERFORM public.require_active_profile();
  PERFORM public._assert_store_membership(p_store_id);
  SELECT role INTO v_role FROM public.profiles
   WHERE auth_user_id = auth.uid() AND store_id = p_store_id;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','finance') THEN
    RAISE EXCEPTION 'sem_permissao_fiscal';
  END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._assert_fiscal_manage(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) RPCs de escrita (únicas portas de gravação da tabela)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_fiscal_document(
  p_store_id uuid,
  p_document_type text,
  p_direction text,
  p_invoice_number text,
  p_issue_date date,
  p_competence_month int,
  p_competence_year int,
  p_total_amount numeric,
  p_series text DEFAULT NULL,
  p_access_key text DEFAULT NULL,
  p_sale_id uuid DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_counterpart_name text DEFAULT NULL,
  p_counterpart_doc text DEFAULT NULL,
  p_xml_path text DEFAULT NULL,
  p_pdf_path text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_id uuid;
  v_key text;
BEGIN
  PERFORM public._assert_fiscal_manage(p_store_id);
  SELECT id INTO v_profile_id FROM public.profiles
   WHERE auth_user_id = auth.uid() AND store_id = p_store_id;

  IF coalesce(btrim(p_invoice_number), '') = '' THEN
    RAISE EXCEPTION 'numero_nota_obrigatorio';
  END IF;
  IF p_total_amount IS NULL OR p_total_amount < 0 THEN
    RAISE EXCEPTION 'valor_invalido';
  END IF;
  IF p_competence_month IS NULL OR p_competence_month NOT BETWEEN 1 AND 12
     OR p_competence_year IS NULL OR p_competence_year NOT BETWEEN 2000 AND 2100 THEN
    RAISE EXCEPTION 'competencia_invalida';
  END IF;

  -- chave de acesso: aceita com máscara, guarda só os 44 dígitos
  v_key := nullif(regexp_replace(coalesce(p_access_key,''), '[^0-9]', '', 'g'), '');
  IF v_key IS NOT NULL AND length(v_key) <> 44 THEN
    RAISE EXCEPTION 'chave_acesso_invalida';
  END IF;

  -- vínculos precisam ser da MESMA loja (barreira multi-tenant explícita)
  IF p_sale_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales s WHERE s.id = p_sale_id AND s.store_id = p_store_id
  ) THEN RAISE EXCEPTION 'venda_invalida'; END IF;
  IF p_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id = p_customer_id AND c.store_id = p_store_id
  ) THEN RAISE EXCEPTION 'cliente_invalido'; END IF;
  IF p_supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers f WHERE f.id = p_supplier_id AND f.store_id = p_store_id
  ) THEN RAISE EXCEPTION 'fornecedor_invalido'; END IF;

  BEGIN
    INSERT INTO public.fiscal_documents(
      store_id, sale_id, customer_id, supplier_id, document_type, direction,
      invoice_number, series, access_key, issue_date, competence_month, competence_year,
      total_amount, counterpart_name, counterpart_doc, xml_path, pdf_path, notes, created_by
    ) VALUES (
      p_store_id, p_sale_id, p_customer_id, p_supplier_id, p_document_type, p_direction,
      btrim(p_invoice_number), nullif(btrim(coalesce(p_series,'')),''), v_key,
      p_issue_date, p_competence_month, p_competence_year,
      round(p_total_amount, 2),
      nullif(btrim(coalesce(p_counterpart_name,'')),''),
      nullif(regexp_replace(coalesce(p_counterpart_doc,''), '[^0-9]', '', 'g'),''),
      nullif(btrim(coalesce(p_xml_path,'')),''),
      nullif(btrim(coalesce(p_pdf_path,'')),''),
      nullif(btrim(coalesce(p_notes,'')),''),
      v_profile_id
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'nota_duplicada';
  END;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (p_store_id, v_profile_id, 'create', 'fiscal_document', v_id,
    jsonb_build_object('document_type', p_document_type, 'direction', p_direction,
      'invoice_number', btrim(p_invoice_number), 'series', p_series,
      'competence', p_competence_year || '-' || lpad(p_competence_month::text, 2, '0'),
      'total_amount', round(p_total_amount, 2), 'sale_id', p_sale_id));

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_fiscal_document(uuid, text, text, text, date, int, int, numeric, text, text, uuid, uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_fiscal_document(uuid, text, text, text, date, int, int, numeric, text, text, uuid, uuid, uuid, text, text, text, text, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.update_fiscal_document(
  p_id uuid,
  p_document_type text,
  p_direction text,
  p_invoice_number text,
  p_issue_date date,
  p_competence_month int,
  p_competence_year int,
  p_total_amount numeric,
  p_series text DEFAULT NULL,
  p_access_key text DEFAULT NULL,
  p_sale_id uuid DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_counterpart_name text DEFAULT NULL,
  p_counterpart_doc text DEFAULT NULL,
  p_xml_path text DEFAULT NULL,
  p_pdf_path text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.fiscal_documents%ROWTYPE;
  v_profile_id uuid;
  v_key text;
  v_before jsonb;
BEGIN
  SELECT * INTO v_row FROM public.fiscal_documents WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'documento_nao_encontrado'; END IF;

  PERFORM public._assert_fiscal_manage(v_row.store_id);
  SELECT id INTO v_profile_id FROM public.profiles
   WHERE auth_user_id = auth.uid() AND store_id = v_row.store_id;

  IF v_row.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'documento_cancelado';
  END IF;
  IF coalesce(btrim(p_invoice_number), '') = '' THEN
    RAISE EXCEPTION 'numero_nota_obrigatorio';
  END IF;
  IF p_total_amount IS NULL OR p_total_amount < 0 THEN
    RAISE EXCEPTION 'valor_invalido';
  END IF;
  IF p_competence_month IS NULL OR p_competence_month NOT BETWEEN 1 AND 12
     OR p_competence_year IS NULL OR p_competence_year NOT BETWEEN 2000 AND 2100 THEN
    RAISE EXCEPTION 'competencia_invalida';
  END IF;

  v_key := nullif(regexp_replace(coalesce(p_access_key,''), '[^0-9]', '', 'g'), '');
  IF v_key IS NOT NULL AND length(v_key) <> 44 THEN
    RAISE EXCEPTION 'chave_acesso_invalida';
  END IF;

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
      document_type = p_document_type,
      direction = p_direction,
      invoice_number = btrim(p_invoice_number),
      series = nullif(btrim(coalesce(p_series,'')),''),
      access_key = v_key,
      issue_date = p_issue_date,
      competence_month = p_competence_month,
      competence_year = p_competence_year,
      total_amount = round(p_total_amount, 2),
      sale_id = p_sale_id,
      customer_id = p_customer_id,
      supplier_id = p_supplier_id,
      counterpart_name = nullif(btrim(coalesce(p_counterpart_name,'')),''),
      counterpart_doc = nullif(regexp_replace(coalesce(p_counterpart_doc,''), '[^0-9]', '', 'g'),''),
      xml_path = nullif(btrim(coalesce(p_xml_path,'')),''),
      pdf_path = nullif(btrim(coalesce(p_pdf_path,'')),''),
      notes = nullif(btrim(coalesce(p_notes,'')),''),
      updated_at = now()
     WHERE id = p_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'nota_duplicada';
  END;

  SELECT * INTO v_row FROM public.fiscal_documents WHERE id = p_id;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
  VALUES (v_row.store_id, v_profile_id, 'update', 'fiscal_document', p_id,
          v_before,
          to_jsonb(v_row) || jsonb_build_object('motivo', nullif(btrim(coalesce(p_reason,'')),'')));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_fiscal_document(uuid, text, text, text, date, int, int, numeric, text, text, uuid, uuid, uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_fiscal_document(uuid, text, text, text, date, int, int, numeric, text, text, uuid, uuid, uuid, text, text, text, text, text, text) TO authenticated;


-- Transições de status. Carimba autor/data no servidor — o cliente não
-- consegue forjar quem enviou ao contador nem quando foi declarado.
CREATE OR REPLACE FUNCTION public.set_fiscal_document_status(
  p_id uuid,
  p_status text,
  p_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.fiscal_documents%ROWTYPE;
  v_profile_id uuid;
  v_before jsonb;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending','sent_to_accountant','declared','cancelled') THEN
    RAISE EXCEPTION 'status_invalido';
  END IF;

  SELECT * INTO v_row FROM public.fiscal_documents WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'documento_nao_encontrado'; END IF;

  PERFORM public._assert_fiscal_manage(v_row.store_id);
  SELECT id INTO v_profile_id FROM public.profiles
   WHERE auth_user_id = auth.uid() AND store_id = v_row.store_id;

  IF v_row.fiscal_status = p_status THEN RETURN; END IF;

  v_before := to_jsonb(v_row);

  UPDATE public.fiscal_documents SET
    fiscal_status = p_status,
    -- reabrir limpa os carimbos posteriores para o histórico não mentir
    sent_to_accountant_at = CASE WHEN p_status = 'sent_to_accountant' THEN now()
                                 WHEN p_status = 'pending' THEN NULL
                                 ELSE sent_to_accountant_at END,
    sent_to_accountant_by = CASE WHEN p_status = 'sent_to_accountant' THEN v_profile_id
                                 WHEN p_status = 'pending' THEN NULL
                                 ELSE sent_to_accountant_by END,
    declared_at = CASE WHEN p_status = 'declared' THEN now()
                       WHEN p_status IN ('pending','sent_to_accountant') THEN NULL
                       ELSE declared_at END,
    declared_by = CASE WHEN p_status = 'declared' THEN v_profile_id
                       WHEN p_status IN ('pending','sent_to_accountant') THEN NULL
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
-- 6) Resumo/KPIs — usado no cabeçalho do módulo e no card do Dashboard.
--    Restrito aos papéis de gestão: vendedor não vê números fiscais da
--    empresa (só as notas das próprias vendas, via RLS de SELECT).
--    Nomes das colunas de saída escolhidos para NÃO colidirem com
--    colunas de fiscal_documents (armadilha de shadowing do plpgsql).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_fiscal_summary(
  p_store_id uuid,
  p_year int DEFAULT NULL,
  p_month int DEFAULT NULL
) RETURNS TABLE (
  pending_count bigint,
  sent_count bigint,
  declared_count bigint,
  cancelled_count bigint,
  period_count bigint,
  pending_amount numeric,
  overdue_count bigint,
  alert_days int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_alert_days int;
BEGIN
  PERFORM public._assert_fiscal_manage(p_store_id);

  SELECT COALESCE((ss.settings->>'alert_days')::int, 15) INTO v_alert_days
    FROM public.store_settings ss
   WHERE ss.store_id = p_store_id AND ss.category = 'fiscal';
  v_alert_days := COALESCE(v_alert_days, 15);

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
      WHERE fd.fiscal_status = 'pending'
        AND fd.issue_date < (current_date - v_alert_days)
    ),
    v_alert_days
  FROM public.fiscal_documents fd
  WHERE fd.store_id = p_store_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_fiscal_summary(uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fiscal_summary(uuid, int, int) TO authenticated;
