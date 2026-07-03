-- Block 5: AI insights — connect_ai_insights table
-- Backfilled 2026-07-01: applied directly in production on 2026-06-21, never committed
-- to git. Reconstructed from the live schema. Idempotent, safe to re-run.

CREATE TABLE IF NOT EXISTS public.connect_ai_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  insight_type text NOT NULL CHECK (insight_type = ANY (ARRAY['suspicious_receipt'::text, 'duplicate_payment'::text, 'sales_drop'::text, 'delinquency_increase'::text, 'frequent_divergence'::text, 'webhook_stale'::text, 'bank_disconnected'::text, 'high_pending_volume'::text])),
  severity text NOT NULL DEFAULT 'warning'::text CHECK (severity = ANY (ARRAY['critical'::text, 'warning'::text, 'info'::text])),
  title text NOT NULL,
  description text NOT NULL,
  suggestion text,
  data jsonb DEFAULT '{}'::jsonb,
  entity_type text,
  entity_id uuid,
  is_dismissed boolean NOT NULL DEFAULT false,
  dismissed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_connect_ai_insights_store ON public.connect_ai_insights USING btree (store_id, is_dismissed, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_ai_insights_type ON public.connect_ai_insights USING btree (store_id, insight_type, created_at DESC);

ALTER TABLE public.connect_ai_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connect_ai_insights_store ON public.connect_ai_insights;
CREATE POLICY connect_ai_insights_store ON public.connect_ai_insights FOR ALL
  USING (store_id IN (SELECT profiles.store_id FROM public.profiles WHERE profiles.auth_user_id = auth.uid()));
