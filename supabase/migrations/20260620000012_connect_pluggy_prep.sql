-- =====================================================================
-- Connect Block 3 — Pluggy V2 Preparation Schema
-- Estrutura preparatória para integração bancária real via Pluggy
-- NÃO ativa Pluggy ainda — apenas prepara o schema
-- =====================================================================

-- Tabela de items conectados via Pluggy (uma por banco conectado)
CREATE TABLE IF NOT EXISTS public.pluggy_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  bank_connection_id UUID REFERENCES public.bank_connections(id) ON DELETE SET NULL,
  -- IDs Pluggy
  pluggy_item_id   TEXT NOT NULL,
  pluggy_account_ids TEXT[] DEFAULT '{}',
  -- Metadados do conector
  connector_id     INTEGER,
  connector_name   TEXT,
  institution_name TEXT,
  -- Status
  status           TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','updating','updated','login_error','waiting_user_input','outdated','error')),
  error_code       TEXT,
  error_message    TEXT,
  -- Datas
  last_updated_at  TIMESTAMPTZ,
  next_update_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, pluggy_item_id)
);

ALTER TABLE public.pluggy_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY pluggy_items_select ON public.pluggy_items
  FOR SELECT TO authenticated
  USING (store_id = public.get_my_store_id());

CREATE POLICY pluggy_items_write ON public.pluggy_items
  FOR ALL TO authenticated
  USING (store_id = public.get_my_store_id())
  WITH CHECK (store_id = public.get_my_store_id());

CREATE INDEX IF NOT EXISTS idx_pluggy_items_store ON public.pluggy_items(store_id);
CREATE INDEX IF NOT EXISTS idx_pluggy_items_item_id ON public.pluggy_items(pluggy_item_id);

-- Tabela de webhooks recebidos do Pluggy (fila de processamento)
CREATE TABLE IF NOT EXISTS public.pluggy_webhooks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  pluggy_item_id   TEXT,
  event_type       TEXT NOT NULL,  -- 'item/updated', 'connector/status_updated' etc
  payload          JSONB NOT NULL DEFAULT '{}',
  processed        BOOLEAN NOT NULL DEFAULT false,
  processed_at     TIMESTAMPTZ,
  error            TEXT,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pluggy_webhooks ENABLE ROW LEVEL SECURITY;

-- Só service role acessa webhooks (inseridos pela Edge Function)
CREATE POLICY pluggy_webhooks_service ON public.pluggy_webhooks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_pluggy_webhooks_item ON public.pluggy_webhooks(pluggy_item_id);
CREATE INDEX IF NOT EXISTS idx_pluggy_webhooks_unprocessed ON public.pluggy_webhooks(processed) WHERE processed = false;

-- RPC auxiliar: registrar webhook (chamado pela Edge Function)
CREATE OR REPLACE FUNCTION public.register_pluggy_webhook(
  p_pluggy_item_id TEXT,
  p_event_type     TEXT,
  p_payload        JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id UUID;
  v_webhook_id UUID;
BEGIN
  -- Encontrar store pelo pluggy_item_id
  SELECT store_id INTO v_store_id
  FROM public.pluggy_items
  WHERE pluggy_item_id = p_pluggy_item_id
  LIMIT 1;

  INSERT INTO public.pluggy_webhooks (store_id, pluggy_item_id, event_type, payload)
  VALUES (v_store_id, p_pluggy_item_id, p_event_type, p_payload)
  RETURNING id INTO v_webhook_id;

  RETURN v_webhook_id;
END;
$$;

-- Apenas service_role pode chamar via Edge Function
GRANT EXECUTE ON FUNCTION public.register_pluggy_webhook(TEXT, TEXT, JSONB) TO service_role;

-- View útil para status de conexões Pluggy por loja
CREATE OR REPLACE VIEW public.pluggy_connection_status AS
SELECT
  pi.store_id,
  pi.id,
  pi.pluggy_item_id,
  pi.institution_name,
  pi.connector_name,
  pi.status,
  pi.last_updated_at,
  pi.next_update_at,
  bc.account_number AS account_name,
  bc.bank_name,
  bc.is_active
FROM public.pluggy_items pi
LEFT JOIN public.bank_connections bc ON bc.id = pi.bank_connection_id;
