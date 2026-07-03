-- Block 5: Bulk reconciliation actions (confirm/ignore in batch)
-- Backfilled 2026-07-01: applied directly in production on 2026-06-21, never committed
-- to git. Reconstructed from the live schema. Idempotent, safe to re-run.

CREATE OR REPLACE FUNCTION public.bulk_confirm_reconciliation(p_store_id uuid, p_match_ids uuid[])
RETURNS TABLE(confirmed_count integer, failed_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_confirmed INTEGER := 0;
  v_failed    UUID[]  := '{}';
  v_match_id  UUID;
  v_profile   UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT id INTO v_profile FROM public.profiles
  WHERE auth_user_id = auth.uid() LIMIT 1;

  FOREACH v_match_id IN ARRAY p_match_ids LOOP
    BEGIN
      UPDATE public.reconciliation_matches
      SET
        status       = 'confirmed',
        confirmed_by = v_profile,
        confirmed_at = NOW(),
        updated_at   = NOW()
      WHERE id = v_match_id
        AND store_id = p_store_id
        AND status = 'pending';

      IF FOUND THEN
        UPDATE public.bank_transactions bt
        SET status = 'reconciled', updated_at = NOW()
        FROM public.reconciliation_matches rm
        WHERE rm.id = v_match_id
          AND bt.id = rm.bank_transaction_id;

        UPDATE public.sales s
        SET payment_status = 'paid', updated_at = NOW()
        FROM public.reconciliation_matches rm
        WHERE rm.id = v_match_id
          AND s.id = rm.suggested_sale_id
          AND rm.suggested_sale_id IS NOT NULL
          AND s.payment_status = 'pending';

        v_confirmed := v_confirmed + 1;
      ELSE
        v_failed := v_failed || v_match_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed || v_match_id;
    END;
  END LOOP;

  RETURN QUERY SELECT v_confirmed, v_failed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_ignore_reconciliation(p_store_id uuid, p_match_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  UPDATE public.reconciliation_matches
  SET status = 'ignored', updated_at = NOW()
  WHERE id = ANY(p_match_ids)
    AND store_id = p_store_id
    AND status = 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
