ALTER TABLE public.payment_verifications
  ADD COLUMN IF NOT EXISTS date_is_recent boolean,
  ADD COLUMN IF NOT EXISTS date_validation_result text;