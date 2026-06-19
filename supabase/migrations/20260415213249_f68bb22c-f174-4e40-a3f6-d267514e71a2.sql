
-- Store Pixels table
CREATE TABLE public.store_pixels (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  pixel_id text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  public_key text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  secret_key text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  is_active boolean NOT NULL DEFAULT true,
  allowed_domains text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_store_pixels_store_id ON public.store_pixels(store_id);
CREATE INDEX idx_store_pixels_pixel_id ON public.store_pixels(pixel_id);
CREATE INDEX idx_store_pixels_public_key ON public.store_pixels(public_key);

ALTER TABLE public.store_pixels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pixels_select" ON public.store_pixels FOR SELECT TO authenticated
  USING (store_id = get_my_store_id());

CREATE POLICY "pixels_insert" ON public.store_pixels FOR INSERT TO authenticated
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() IN ('owner','admin'));

CREATE POLICY "pixels_update" ON public.store_pixels FOR UPDATE TO authenticated
  USING (store_id = get_my_store_id() AND get_my_role() IN ('owner','admin'));

CREATE POLICY "sa_pixels_select" ON public.store_pixels FOR SELECT TO authenticated
  USING (is_super_admin());

-- Pixel Events table
CREATE TABLE public.pixel_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  pixel_id text NOT NULL,
  event_type text NOT NULL,
  external_event_id text,
  external_order_id text,
  external_customer_id text,
  payload_json jsonb NOT NULL DEFAULT '{}',
  processing_status text NOT NULL DEFAULT 'pending',
  error_message text,
  sale_id uuid REFERENCES public.sales(id),
  customer_id uuid REFERENCES public.customers(id),
  return_id uuid REFERENCES public.returns(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX idx_pixel_events_store_id ON public.pixel_events(store_id);
CREATE INDEX idx_pixel_events_pixel_id ON public.pixel_events(pixel_id);
CREATE INDEX idx_pixel_events_external_event ON public.pixel_events(external_event_id);
CREATE INDEX idx_pixel_events_external_order ON public.pixel_events(store_id, external_order_id);
CREATE INDEX idx_pixel_events_status ON public.pixel_events(processing_status);
CREATE INDEX idx_pixel_events_received ON public.pixel_events(received_at DESC);

ALTER TABLE public.pixel_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pixel_events_select" ON public.pixel_events FOR SELECT TO authenticated
  USING (store_id = get_my_store_id());

CREATE POLICY "sa_pixel_events_select" ON public.pixel_events FOR SELECT TO authenticated
  USING (is_super_admin());

-- Enable realtime for pixel_events
ALTER PUBLICATION supabase_realtime ADD TABLE public.pixel_events;
