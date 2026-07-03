-- Reconciliation: fix sales corrupted by the edit_sale_atomic partial payment bug.
--
-- The bug set amount_paid=0 and amount_pending=net_total when a partial sale
-- was edited. The real payment records in the payments table were never deleted,
-- so we reconstruct the correct values from them.
--
-- Logic per sale:
--   real_paid   = SUM(payments WHERE method != 'pending')
--   new_pending = GREATEST(net_total - real_paid, 0)
--   new_status  = 'paid' | 'partial' | 'pending'
--
-- Also fixes the 'pending' placeholder row in payments.
-- Logs every change to audit_logs.

DO $$
DECLARE
  r          record;
  v_real_paid    numeric;
  v_new_pending  numeric;
  v_new_status   text;
  v_actor        uuid;
  v_fixed        int := 0;
  v_checked      int := 0;
BEGIN
  -- Iterate only over sales that have real (non-pending) payments recorded
  -- but whose stored amount_paid doesn't match the sum of those payments.
  FOR r IN
    SELECT
      s.id,
      s.store_id,
      s.net_total,
      s.amount_paid,
      s.amount_pending,
      s.payment_status,
      pay_sum.real_paid
    FROM public.sales s
    JOIN LATERAL (
      SELECT COALESCE(SUM(p.amount), 0) AS real_paid
        FROM public.payments p
       WHERE p.sale_id = s.id AND p.method != 'pending'
    ) pay_sum ON true
    WHERE s.deleted_at IS NULL
      AND s.status NOT IN ('cancelled', 'refunded', 'returned')
      AND pay_sum.real_paid > 0                          -- has real payments
      AND ABS(s.amount_paid - pay_sum.real_paid) > 0.005 -- but amount_paid is wrong
    ORDER BY s.store_id, s.created_at
  LOOP
    v_checked := v_checked + 1;
    v_real_paid   := r.real_paid;
    v_new_pending := GREATEST(r.net_total - v_real_paid, 0);
    v_new_status  := CASE
      WHEN v_real_paid >= r.net_total THEN 'paid'
      WHEN v_real_paid >  0           THEN 'partial'
      ELSE                                 'pending'
    END;

    -- Fix the sale row
    UPDATE public.sales
       SET amount_paid    = v_real_paid,
           amount_pending = v_new_pending,
           payment_status = v_new_status
     WHERE id = r.id;

    -- Fix (or remove) the 'pending' placeholder payment row
    IF v_new_pending <= 0 THEN
      DELETE FROM public.payments
       WHERE sale_id = r.id AND method = 'pending';
    ELSE
      UPDATE public.payments
         SET amount = v_new_pending
       WHERE sale_id = r.id AND method = 'pending';
    END IF;

    -- Audit log — use the store owner's profile as actor
    SELECT id INTO v_actor
      FROM public.profiles
     WHERE store_id = r.store_id AND role = 'owner' AND is_active = true
     ORDER BY created_at ASC LIMIT 1;

    IF v_actor IS NULL THEN
      SELECT id INTO v_actor
        FROM public.profiles
       WHERE store_id = r.store_id AND is_active = true
       ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_actor IS NOT NULL THEN
      INSERT INTO public.audit_logs(
        store_id, actor_profile_id, action, entity, entity_id, after_json
      ) VALUES (
        r.store_id,
        v_actor,
        'reconciliation_fix',
        'sale',
        r.id,
        jsonb_build_object(
          'reason',           'auto-reconciliation: edit_sale_atomic partial payment bug',
          'old_amount_paid',    r.amount_paid,
          'new_amount_paid',    v_real_paid,
          'old_amount_pending', r.amount_pending,
          'new_amount_pending', v_new_pending,
          'old_status',         r.payment_status,
          'new_status',         v_new_status
        )
      );
    END IF;

    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'Reconciliation complete: checked=%, fixed=%', v_checked, v_fixed;
END $$;
