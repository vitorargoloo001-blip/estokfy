
-- Add new columns to categories
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS color text DEFAULT '#6B7280',
  ADD COLUMN IF NOT EXISTS icon text DEFAULT 'Tag',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- Unique name per store
ALTER TABLE public.categories
  ADD CONSTRAINT categories_name_store_unique UNIQUE (store_id, name);

-- Generate slugs for existing rows
UPDATE public.categories SET slug = lower(replace(replace(name, ' ', '-'), '.', '')) WHERE slug IS NULL;

-- Create function to auto-generate slug
CREATE OR REPLACE FUNCTION public.generate_category_slug()
RETURNS TRIGGER AS $$
BEGIN
  NEW.slug := lower(regexp_replace(replace(NEW.name, ' ', '-'), '[^a-z0-9\-]', '', 'g'));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_category_slug
  BEFORE INSERT OR UPDATE OF name ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_category_slug();
