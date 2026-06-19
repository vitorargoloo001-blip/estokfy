
-- 1) SNAPSHOT
INSERT INTO public.audit_logs (store_id, action, entity, entity_id, before_json)
SELECT s.store_id, 'duplicate_detected', 'sale_items', si.sale_id,
       jsonb_build_object('product_id', si.product_id, 'qty', si.qty, 'unit_price', si.unit_price, 'dup_count', COUNT(*))
FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id
GROUP BY s.store_id, si.sale_id, si.product_id, si.qty, si.unit_price
HAVING COUNT(*) > 1;

INSERT INTO public.audit_logs (store_id, action, entity, entity_id, before_json)
SELECT store_id, 'duplicate_detected', 'cash_entries', reference_id,
       jsonb_build_object('reference_type', reference_type, 'amount', amount, 'dup_count', COUNT(*))
FROM public.cash_entries WHERE reference_id IS NOT NULL
GROUP BY store_id, reference_type, reference_id, amount HAVING COUNT(*) > 1;

-- 2) REMOÇÃO
WITH r AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY sale_id, product_id, qty, unit_price ORDER BY id) rn FROM public.sale_items)
DELETE FROM public.sale_items WHERE id IN (SELECT id FROM r WHERE rn > 1);

WITH r AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY store_id, reference_type, reference_id, amount ORDER BY occurred_at) rn FROM public.cash_entries WHERE reference_id IS NOT NULL)
DELETE FROM public.cash_entries WHERE id IN (SELECT id FROM r WHERE rn > 1);

WITH r AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY sale_id, method, amount, (extract(epoch from paid_at)::bigint/60) ORDER BY paid_at, id) rn FROM public.payments WHERE sale_id IS NOT NULL)
DELETE FROM public.payments WHERE id IN (SELECT id FROM r WHERE rn > 1);

-- 3) COLUNAS
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS paid_at_minute bigint;
ALTER TABLE public.cash_entries ADD COLUMN IF NOT EXISTS payment_id uuid;
ALTER TABLE public.cash_entries ADD COLUMN IF NOT EXISTS occurred_at_minute bigint;

-- backfill
UPDATE public.cash_entries SET payment_id = reference_id WHERE reference_type = 'payment' AND payment_id IS NULL;
UPDATE public.payments SET paid_at_minute = (extract(epoch from paid_at)::bigint/60) WHERE paid_at_minute IS NULL;
UPDATE public.cash_entries SET occurred_at_minute = (extract(epoch from occurred_at)::bigint/60) WHERE occurred_at_minute IS NULL;

-- 4) TRIGGER para manter colunas de minuto
CREATE OR REPLACE FUNCTION public.set_paid_at_minute()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.paid_at_minute := (extract(epoch from NEW.paid_at)::bigint/60);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payments_paid_at_minute ON public.payments;
CREATE TRIGGER trg_payments_paid_at_minute
  BEFORE INSERT OR UPDATE OF paid_at ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_paid_at_minute();

CREATE OR REPLACE FUNCTION public.set_occurred_at_minute()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.occurred_at_minute := (extract(epoch from NEW.occurred_at)::bigint/60);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cash_entries_occurred_at_minute ON public.cash_entries;
CREATE TRIGGER trg_cash_entries_occurred_at_minute
  BEFORE INSERT OR UPDATE OF occurred_at ON public.cash_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_occurred_at_minute();

-- 5) ÍNDICES ÚNICOS DEFENSIVOS
CREATE UNIQUE INDEX IF NOT EXISTS payments_idem_key_uniq
  ON public.payments(store_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_sale_dedup_uniq
  ON public.payments(sale_id, method, amount, paid_at_minute) WHERE sale_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cash_entries_payment_uniq
  ON public.cash_entries(payment_id) WHERE payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cash_entries_sale_dedup_uniq
  ON public.cash_entries(store_id, reference_type, reference_id, amount, occurred_at_minute)
  WHERE reference_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sale_items_dedup_uniq
  ON public.sale_items(sale_id, product_id, qty, unit_price);

-- 6) PERFORMANCE
CREATE INDEX IF NOT EXISTS payments_store_paid_at_idx ON public.payments(store_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS sales_store_created_at_idx ON public.sales(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_entries_store_occurred_at_idx ON public.cash_entries(store_id, occurred_at DESC);
