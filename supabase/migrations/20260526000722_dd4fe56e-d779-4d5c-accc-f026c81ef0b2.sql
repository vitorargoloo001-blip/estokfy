
CREATE OR REPLACE FUNCTION public.set_paid_at_minute()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.paid_at_minute := (extract(epoch from NEW.paid_at)::bigint/60);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.set_occurred_at_minute()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.occurred_at_minute := (extract(epoch from NEW.occurred_at)::bigint/60);
  RETURN NEW;
END $$;
