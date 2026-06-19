
-- 1) Soft-delete columns on sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason text;

CREATE INDEX IF NOT EXISTS idx_sales_deleted_at ON public.sales (store_id, deleted_at);

-- 2) Audit table for deleted sales
CREATE TABLE IF NOT EXISTS public.sale_deletion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_by_user_id uuid,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deletion_reason text NOT NULL,
  original_sale_data jsonb NOT NULL,
  original_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  original_payments jsonb NOT NULL DEFAULT '[]'::jsonb,
  original_total numeric NOT NULL DEFAULT 0,
  original_amount_paid numeric NOT NULL DEFAULT 0,
  original_payment_status text,
  original_payment_method text,
  original_customer_id uuid,
  impacts jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.sale_deletion_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sdl_select ON public.sale_deletion_logs;
CREATE POLICY sdl_select ON public.sale_deletion_logs
  FOR SELECT TO authenticated
  USING (store_id = get_my_store_id());

DROP POLICY IF EXISTS sdl_insert ON public.sale_deletion_logs;
CREATE POLICY sdl_insert ON public.sale_deletion_logs
  FOR INSERT TO authenticated
  WITH CHECK (store_id = get_my_store_id());

CREATE INDEX IF NOT EXISTS idx_sdl_store_deleted_at ON public.sale_deletion_logs (store_id, deleted_at DESC);

-- 3) RPC delete_sale_permanently
CREATE OR REPLACE FUNCTION public.delete_sale_permanently(
  p_sale_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_store uuid := get_my_store_id();
  v_role text := get_my_role();
  v_user uuid := auth.uid();
  v_profile uuid;
  v_sale public.sales%ROWTYPE;
  v_items jsonb;
  v_payments jsonb;
  v_total_paid numeric := 0;
  v_ledger uuid;
  v_item record;
  v_loyalty_result jsonb := '{}'::jsonb;
  v_impacts jsonb := '{}'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  IF v_role NOT IN ('owner','admin','manager') THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  -- Lock the sale
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.store_id <> v_store THEN
    RAISE EXCEPTION 'forbidden_store' USING ERRCODE = '42501';
  END IF;
  IF v_sale.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'sale_already_deleted' USING ERRCODE = '22023';
  END IF;

  -- Resolve actor profile (with fallback to store owner)
  SELECT id INTO v_profile FROM public.profiles
    WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;
  IF v_profile IS NULL THEN
    SELECT id INTO v_profile FROM public.profiles
      WHERE store_id = v_store AND role = 'owner' AND is_active = true LIMIT 1;
  END IF;
  IF v_profile IS NULL THEN
    SELECT id INTO v_profile FROM public.profiles
      WHERE store_id = v_store AND is_active = true LIMIT 1;
  END IF;

  -- Snapshot items + payments
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', si.id, 'product_id', si.product_id, 'qty', si.qty,
            'unit_price', si.unit_price, 'unit_cost', si.unit_cost, 'line_total', si.line_total)), '[]'::jsonb)
    INTO v_items
    FROM public.sale_items si WHERE si.sale_id = p_sale_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', p.id, 'method', p.method, 'amount', p.amount, 'paid_at', p.paid_at)), '[]'::jsonb),
         COALESCE(SUM(p.amount), 0)
    INTO v_payments, v_total_paid
    FROM public.payments p WHERE p.sale_id = p_sale_id;

  -- 1) Stock restock
  FOR v_item IN
    SELECT product_id, SUM(qty)::int AS qty
      FROM public.sale_items WHERE sale_id = p_sale_id
      GROUP BY product_id
  LOOP
    INSERT INTO public.stock_movements (
      store_id, product_id, movement_type, qty, reference_type, reference_id, reason, created_by
    ) VALUES (
      v_store, v_item.product_id, 'return_in', v_item.qty,
      'sale_deletion', p_sale_id,
      'Estorno por exclusão de venda', v_profile
    );
    UPDATE public.products
       SET on_hand = COALESCE(on_hand,0) + v_item.qty,
           updated_at = now()
     WHERE id = v_item.product_id AND store_id = v_store;
  END LOOP;

  v_impacts := v_impacts || jsonb_build_object('stock_reverted', true);

  -- 2) Cash reversal if there were payments
  IF v_total_paid > 0 THEN
    SELECT id INTO v_ledger FROM public.cash_ledger
      WHERE store_id = v_store AND is_default = true LIMIT 1;
    IF v_ledger IS NULL THEN
      SELECT id INTO v_ledger FROM public.cash_ledger WHERE store_id = v_store LIMIT 1;
    END IF;
    IF v_ledger IS NOT NULL THEN
      INSERT INTO public.cash_entries (
        store_id, ledger_id, entry_type, category, amount,
        payment_method, occurred_at, reference_type, reference_id,
        description, created_by
      ) VALUES (
        v_store, v_ledger, 'expense', 'estorno_venda', v_total_paid,
        NULL, now(), 'sale_deletion', p_sale_id,
        'Estorno por exclusão de venda #' || substr(p_sale_id::text,1,8), v_profile
      );
      v_impacts := v_impacts || jsonb_build_object('cash_reverted', v_total_paid);
    END IF;
  END IF;

  -- 3) Loyalty: revert credit uses for this sale
  BEGIN
    v_loyalty_result := public.revert_loyalty_credit_uses_for_sale(p_sale_id);
    v_impacts := v_impacts || jsonb_build_object('loyalty', v_loyalty_result);
  EXCEPTION WHEN OTHERS THEN
    v_impacts := v_impacts || jsonb_build_object('loyalty_error', SQLERRM);
  END;

  -- 4) Audit log (sale_audit_logs)
  INSERT INTO public.sale_audit_logs (
    sale_id, store_id, actor_profile_id, actor_user_id, reason, changes, before_json
  ) VALUES (
    p_sale_id, v_store, v_profile, v_user, 'Exclusão de venda',
    jsonb_build_object('action','deleted','reason', p_reason),
    to_jsonb(v_sale)
  );

  -- 5) Insert deletion log
  INSERT INTO public.sale_deletion_logs (
    sale_id, store_id, deleted_by, deleted_by_user_id, deletion_reason,
    original_sale_data, original_items, original_payments,
    original_total, original_amount_paid, original_payment_status, original_payment_method,
    original_customer_id, impacts
  ) VALUES (
    p_sale_id, v_store, v_profile, v_user, p_reason,
    to_jsonb(v_sale), v_items, v_payments,
    v_sale.net_total, v_sale.amount_paid, v_sale.payment_status,
    (SELECT method FROM public.payments WHERE sale_id = p_sale_id ORDER BY amount DESC LIMIT 1),
    v_sale.customer_id, v_impacts
  );

  -- 6) Soft delete the sale (set status cancelled, zero pending so AR queries clear)
  UPDATE public.sales
     SET deleted_at = now(),
         deleted_by = v_profile,
         deletion_reason = p_reason,
         status = 'cancelled',
         amount_pending = 0
   WHERE id = p_sale_id;

  -- 7) Recalc loyalty for the customer if any
  IF v_sale.customer_id IS NOT NULL THEN
    BEGIN
      PERFORM public.recalc_loyalty_for_customer(v_sale.customer_id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'sale_id', p_sale_id,
    'impacts', v_impacts
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_sale_permanently(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_sale_permanently(uuid, text) TO authenticated;
