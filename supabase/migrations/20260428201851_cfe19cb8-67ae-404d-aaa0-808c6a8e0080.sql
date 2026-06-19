
-- ============================================================
-- ACCOUNTS PAYABLE: contas a pagar
-- ============================================================
CREATE TABLE IF NOT EXISTS public.accounts_payable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  description text NOT NULL,
  category text NOT NULL DEFAULT 'outros',
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  due_date date NOT NULL,
  payment_method text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  notes text,
  paid_at timestamptz,
  paid_amount numeric,
  cash_entry_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payable_store_status ON public.accounts_payable(store_id, status, due_date);

ALTER TABLE public.accounts_payable ENABLE ROW LEVEL SECURITY;

CREATE POLICY ap_select ON public.accounts_payable FOR SELECT TO authenticated
  USING (store_id = public.get_my_store_id());

CREATE POLICY ap_insert ON public.accounts_payable FOR INSERT TO authenticated
  WITH CHECK (store_id = public.get_my_store_id()
    AND public.get_my_role() = ANY (ARRAY['owner','admin','manager','finance']));

CREATE POLICY ap_update ON public.accounts_payable FOR UPDATE TO authenticated
  USING (store_id = public.get_my_store_id()
    AND public.get_my_role() = ANY (ARRAY['owner','admin','manager','finance']))
  WITH CHECK (store_id = public.get_my_store_id());

CREATE POLICY ap_delete ON public.accounts_payable FOR DELETE TO authenticated
  USING (store_id = public.get_my_store_id()
    AND public.get_my_role() = ANY (ARRAY['owner','admin','manager','finance']));

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.touch_accounts_payable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_payable_touch BEFORE UPDATE ON public.accounts_payable
FOR EACH ROW EXECUTE FUNCTION public.touch_accounts_payable();

-- RPC: quitar conta a pagar (gera cash_entry como expense)
CREATE OR REPLACE FUNCTION public.settle_payable(
  p_payable_id uuid,
  p_payment_method text DEFAULT 'cash',
  p_paid_amount numeric DEFAULT NULL,
  p_paid_at timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ctx record;
  v_pay record;
  v_amount numeric;
  v_entry_id uuid;
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();

  SELECT * INTO v_pay FROM public.accounts_payable WHERE id = p_payable_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conta_nao_encontrada'; END IF;
  IF v_pay.store_id <> v_ctx.store_id THEN RAISE EXCEPTION 'store_invalida'; END IF;
  IF v_ctx.role NOT IN ('owner','admin','manager','finance') THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;
  IF v_pay.status = 'paid' THEN RAISE EXCEPTION 'conta_ja_paga'; END IF;
  IF v_pay.status = 'cancelled' THEN RAISE EXCEPTION 'conta_cancelada'; END IF;

  v_amount := COALESCE(p_paid_amount, v_pay.amount);

  INSERT INTO public.cash_entries(store_id, ledger_id, entry_type, category, amount, payment_method, reference_type, reference_id, description, created_by, occurred_at)
  SELECT v_pay.store_id, l.id, 'expense', v_pay.category, v_amount, p_payment_method, 'payable', v_pay.id, v_pay.description, v_ctx.profile_id, p_paid_at
  FROM public.cash_ledger l WHERE l.store_id = v_pay.store_id AND l.is_default = true
  LIMIT 1
  RETURNING id INTO v_entry_id;

  UPDATE public.accounts_payable
    SET status = 'paid',
        paid_at = p_paid_at,
        paid_amount = v_amount,
        cash_entry_id = v_entry_id,
        payment_method = p_payment_method
  WHERE id = p_payable_id;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (v_pay.store_id, v_ctx.profile_id, 'settle', 'payable', v_pay.id,
    jsonb_build_object('amount', v_amount, 'method', p_payment_method));

  RETURN jsonb_build_object('payable_id', v_pay.id, 'cash_entry_id', v_entry_id, 'amount', v_amount, 'status','paid');
END;
$$;

-- View dinâmica auxiliar (não persistida): vencidas = pending AND due_date < today
-- Implementada no front via filtros simples.
