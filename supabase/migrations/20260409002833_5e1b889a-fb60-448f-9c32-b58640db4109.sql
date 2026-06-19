
-- AI Conversations
CREATE TABLE public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  route text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ai_conv_store_created ON public.ai_conversations(store_id, created_at DESC);

CREATE POLICY "ai_conv_select" ON public.ai_conversations FOR SELECT TO authenticated
  USING (store_id = get_my_store_id() AND profile_id = (SELECT profile_id FROM public.current_profile()));
CREATE POLICY "ai_conv_insert" ON public.ai_conversations FOR INSERT TO authenticated
  WITH CHECK (store_id = get_my_store_id() AND profile_id = (SELECT profile_id FROM public.current_profile()));
CREATE POLICY "ai_conv_update" ON public.ai_conversations FOR UPDATE TO authenticated
  USING (store_id = get_my_store_id() AND profile_id = (SELECT profile_id FROM public.current_profile()));

-- AI Messages
CREATE TABLE public.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  redacted_content text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ai_msg_conv ON public.ai_messages(conversation_id, created_at);

CREATE POLICY "ai_msg_select" ON public.ai_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = ai_messages.conversation_id AND c.store_id = get_my_store_id() AND c.profile_id = (SELECT profile_id FROM public.current_profile())));
CREATE POLICY "ai_msg_insert" ON public.ai_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = ai_messages.conversation_id AND c.store_id = get_my_store_id() AND c.profile_id = (SELECT profile_id FROM public.current_profile())));

-- AI Events (action log)
CREATE TABLE public.ai_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id),
  action_type text NOT NULL,
  action_payload jsonb,
  confirmed boolean DEFAULT false,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ai_events_conv ON public.ai_events(conversation_id);

CREATE POLICY "ai_events_select" ON public.ai_events FOR SELECT TO authenticated
  USING (store_id = get_my_store_id());
CREATE POLICY "ai_events_insert" ON public.ai_events FOR INSERT TO authenticated
  WITH CHECK (store_id = get_my_store_id());
CREATE POLICY "ai_events_update" ON public.ai_events FOR UPDATE TO authenticated
  USING (store_id = get_my_store_id());

-- AI Handoffs
CREATE TABLE public.ai_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  assigned_to uuid REFERENCES public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_handoffs_select" ON public.ai_handoffs FOR SELECT TO authenticated
  USING (store_id = get_my_store_id() AND get_my_role() IN ('owner','admin','manager'));
CREATE POLICY "ai_handoffs_insert" ON public.ai_handoffs FOR INSERT TO authenticated
  WITH CHECK (store_id = get_my_store_id());
CREATE POLICY "ai_handoffs_update" ON public.ai_handoffs FOR UPDATE TO authenticated
  USING (store_id = get_my_store_id() AND get_my_role() IN ('owner','admin','manager'));

-- AI Training Data (knowledge base)
CREATE TABLE public.ai_training_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id),
  intent text NOT NULL,
  category text NOT NULL,
  question_example text NOT NULL,
  answer_template text NOT NULL,
  action_type text,
  is_global boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_training_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_training_select" ON public.ai_training_data FOR SELECT TO authenticated
  USING (is_global = true OR store_id = get_my_store_id());
CREATE POLICY "ai_training_insert" ON public.ai_training_data FOR INSERT TO authenticated
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() IN ('owner','admin'));
CREATE POLICY "ai_training_update" ON public.ai_training_data FOR UPDATE TO authenticated
  USING (store_id = get_my_store_id() AND get_my_role() IN ('owner','admin'));

-- Seed 30 intents (global)
INSERT INTO public.ai_training_data (intent, category, question_example, answer_template, action_type, is_global, store_id) VALUES
-- Vendas (6)
('criar_venda', 'venda', 'Quero vender 2 baterias', 'Vou criar a venda. Confirme os itens: {{items}}. Posso prosseguir?', 'sales-create', true, NULL),
('consultar_venda', 'venda', 'Qual foi a última venda?', 'A última venda foi #{{sale_id}} no valor de {{net_total}}, feita em {{created_at}}.', NULL, true, NULL),
('status_venda', 'venda', 'Qual o status da venda X?', 'A venda {{sale_id}} está com status: {{status}}.', NULL, true, NULL),
('cancelar_venda', 'venda', 'Preciso cancelar a venda', 'Cancelamentos precisam ser processados como devolução. Deseja criar uma devolução?', 'returns-create', true, NULL),
('vendas_do_dia', 'venda', 'Quantas vendas hoje?', 'Hoje tivemos {{count}} vendas, totalizando {{total}}.', NULL, true, NULL),
('aplicar_desconto', 'venda', 'Posso dar desconto?', 'Informe o valor do desconto e os itens. Vou incluir na venda.', 'sales-create', true, NULL),
-- Trocas/Devoluções (6)
('criar_devolucao', 'troca', 'Cliente quer devolver produto', 'Vou registrar a devolução. Qual o motivo? (defeito, danificado, item errado, arrependimento)', 'returns-create', true, NULL),
('consultar_devolucao', 'troca', 'Tem alguma devolução pendente?', 'Encontrei {{count}} devoluções pendentes.', NULL, true, NULL),
('politica_troca', 'troca', 'Qual a política de troca?', 'Nossa política permite trocas em até 7 dias com produto em condições originais.', NULL, true, NULL),
('reembolso', 'troca', 'Como funciona o reembolso?', 'O reembolso é processado automaticamente ao aprovar a devolução, creditado no caixa.', NULL, true, NULL),
('trocar_produto', 'troca', 'Quero trocar por outro modelo', 'Vou registrar a devolução do item atual e criar uma nova venda com o novo item. Confirma?', 'returns-create', true, NULL),
('status_devolucao', 'troca', 'Qual o status da devolução?', 'A devolução {{return_id}} está com status: {{status}}.', NULL, true, NULL),
-- Estoque (6)
('consultar_estoque', 'estoque', 'Quantas unidades tem da bateria X?', 'O produto {{name}} (SKU: {{sku}}) tem {{on_hand}} unidades em estoque.', NULL, true, NULL),
('ajustar_estoque', 'estoque', 'Preciso dar entrada de 10 unidades', 'Vou ajustar o estoque: +{{qty}} unidades de {{product}}. Confirma?', 'stock-adjust', true, NULL),
('estoque_baixo', 'estoque', 'Quais produtos estão com estoque baixo?', 'Encontrei {{count}} produtos abaixo do mínimo: {{products}}.', NULL, true, NULL),
('inventario', 'estoque', 'Como faço inventário?', 'Use a tela de Estoque para ajustar as quantidades. Posso ajustar um produto específico agora?', 'stock-adjust', true, NULL),
('perda_estoque', 'estoque', 'Tive uma perda de produto', 'Vou registrar a perda no estoque: -{{qty}} de {{product}}. Motivo: {{reason}}. Confirma?', 'stock-adjust', true, NULL),
('transferir_estoque', 'estoque', 'Preciso transferir entre lojas', 'Transferências entre lojas ainda não estão disponíveis. Registre uma saída manual na origem e entrada no destino.', NULL, true, NULL),
-- Entregas (6)
('status_entrega', 'entrega', 'Qual o status da entrega?', 'A entrega {{delivery_id}} está: {{status}}. Método: {{method}}.', NULL, true, NULL),
('rastrear_entrega', 'entrega', 'Tem código de rastreio?', 'O código de rastreio é: {{tracking_code}}.', NULL, true, NULL),
('entregas_pendentes', 'entrega', 'Quantas entregas pendentes?', 'Há {{count}} entregas pendentes no momento.', NULL, true, NULL),
('agendar_entrega', 'entrega', 'Preciso agendar uma entrega', 'As entregas são criadas automaticamente com a venda. Qual venda deseja verificar?', NULL, true, NULL),
('custo_frete', 'entrega', 'Quanto custa o frete?', 'O custo do frete depende do método: retirada (grátis), motoboy ou transportadora.', NULL, true, NULL),
('confirmar_entrega', 'entrega', 'Entrega foi realizada', 'Vou marcar a entrega como concluída. Confirma?', NULL, true, NULL),
-- Caixa/Financeiro (6)
('fechamento_caixa', 'caixa', 'Como fecho o caixa?', 'Acesse Financeiro para ver o resumo do dia. Total de entradas: {{income}}, saídas: {{expenses}}.', NULL, true, NULL),
('saldo_caixa', 'caixa', 'Qual o saldo do caixa?', 'O saldo atual do caixa é {{balance}}.', NULL, true, NULL),
('registrar_despesa', 'caixa', 'Preciso registrar uma despesa', 'Acesse Financeiro > Nova Entrada para registrar a despesa com categoria e valor.', NULL, true, NULL),
('relatorio_financeiro', 'caixa', 'Quero ver o relatório financeiro', 'Vou gerar o relatório do período. Qual intervalo? (hoje, semana, mês)', 'reports-summary', true, NULL),
('faturamento_mes', 'caixa', 'Qual o faturamento do mês?', 'O faturamento deste mês é {{revenue}}, com lucro bruto de {{profit}}.', 'reports-summary', true, NULL),
('metodo_pagamento', 'caixa', 'Quais formas de pagamento aceitas?', 'Aceitamos: dinheiro, PIX, cartão de crédito, cartão de débito e boleto.', NULL, true, NULL);
