ALTER TABLE public.bulk_operations_log
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS processed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_count integer NOT NULL DEFAULT 0;