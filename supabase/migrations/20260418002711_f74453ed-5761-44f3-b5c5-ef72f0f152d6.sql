-- 1. Tabela de análises IA persistentes
CREATE TABLE IF NOT EXISTS public.report_ai_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id),
  report_type text NOT NULL DEFAULT 'detailed',
  period_start date NOT NULL,
  period_end date NOT NULL,
  analysis_text text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rai_store_period
  ON public.report_ai_analyses (store_id, period_start, period_end, created_at DESC);

ALTER TABLE public.report_ai_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY rai_select ON public.report_ai_analyses
  FOR SELECT TO authenticated
  USING (store_id = public.get_my_store_id());

CREATE POLICY rai_insert ON public.report_ai_analyses
  FOR INSERT TO authenticated
  WITH CHECK (store_id = public.get_my_store_id());

CREATE POLICY rai_update ON public.report_ai_analyses
  FOR UPDATE TO authenticated
  USING (store_id = public.get_my_store_id())
  WITH CHECK (store_id = public.get_my_store_id());

CREATE POLICY rai_delete ON public.report_ai_analyses
  FOR DELETE TO authenticated
  USING (store_id = public.get_my_store_id()
         AND public.get_my_role() = ANY (ARRAY['owner','admin','manager']));

-- 2. Forma de pagamento em despesas/entradas financeiras
ALTER TABLE public.cash_entries
  ADD COLUMN IF NOT EXISTS payment_method text;

COMMENT ON COLUMN public.cash_entries.payment_method IS
  'Forma de pagamento: pix | card | cash | transfer | other (nullable para registros antigos)';
