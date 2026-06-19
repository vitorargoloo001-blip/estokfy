
-- =====================================================
-- MÓDULO ORDEM DE SERVIÇO (OS)
-- =====================================================

-- 1) store_settings: termos da OS
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS os_terms_text text DEFAULT 'O cliente declara estar ciente das condições do aparelho no momento da entrada, dos serviços solicitados e dos prazos informados. A retirada do aparelho só será realizada mediante confirmação de pagamento quando houver valor pendente.';

-- 2) service_orders
CREATE TABLE IF NOT EXISTS public.service_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  os_number integer NOT NULL,
  customer_id uuid,
  customer_name text NOT NULL,
  customer_phone text,
  device text NOT NULL,
  brand text,
  model text,
  imei_serial text,
  device_password text,
  accessories text,
  device_condition text,
  reported_issue text NOT NULL,
  internal_notes text,
  priority text NOT NULL DEFAULT 'normal',
  technician_profile_id uuid,
  entry_date timestamptz NOT NULL DEFAULT now(),
  estimated_delivery date,
  delivered_at timestamptz,
  status text NOT NULL DEFAULT 'aberta',
  labor_amount numeric NOT NULL DEFAULT 0,
  parts_amount numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  pending_amount numeric NOT NULL DEFAULT 0,
  terms_snapshot text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  UNIQUE (store_id, os_number),
  CONSTRAINT so_status_chk CHECK (status IN ('aberta','em_analise','aguardando_aprovacao','aguardando_peca','em_reparo','pronta_retirada','entregue','cancelada')),
  CONSTRAINT so_priority_chk CHECK (priority IN ('baixa','normal','alta','urgente'))
);

CREATE INDEX IF NOT EXISTS idx_so_store_status ON public.service_orders(store_id, status);
CREATE INDEX IF NOT EXISTS idx_so_store_customer ON public.service_orders(store_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_so_store_tech ON public.service_orders(store_id, technician_profile_id);
CREATE INDEX IF NOT EXISTS idx_so_entry ON public.service_orders(store_id, entry_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_orders TO authenticated;
GRANT ALL ON public.service_orders TO service_role;
ALTER TABLE public.service_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY so_select ON public.service_orders FOR SELECT TO authenticated
  USING (store_id = get_my_store_id());
CREATE POLICY so_insert ON public.service_orders FOR INSERT TO authenticated
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() = ANY (ARRAY['owner','admin','manager','sales','stock']));
CREATE POLICY so_update ON public.service_orders FOR UPDATE TO authenticated
  USING (store_id = get_my_store_id() AND get_my_role() = ANY (ARRAY['owner','admin','manager','sales','stock']))
  WITH CHECK (store_id = get_my_store_id());
CREATE POLICY so_delete ON public.service_orders FOR DELETE TO authenticated
  USING (store_id = get_my_store_id() AND get_my_role() = ANY (ARRAY['owner','admin']));

-- 3) service_order_items
CREATE TABLE IF NOT EXISTS public.service_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  service_order_id uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  product_id uuid,
  description text NOT NULL,
  qty numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  stock_movement_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT soi_type_chk CHECK (item_type IN ('service','part'))
);
CREATE INDEX IF NOT EXISTS idx_soi_os ON public.service_order_items(service_order_id);
CREATE INDEX IF NOT EXISTS idx_soi_store ON public.service_order_items(store_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_order_items TO authenticated;
GRANT ALL ON public.service_order_items TO service_role;
ALTER TABLE public.service_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY soi_select ON public.service_order_items FOR SELECT TO authenticated
  USING (store_id = get_my_store_id());
CREATE POLICY soi_insert ON public.service_order_items FOR INSERT TO authenticated
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() = ANY (ARRAY['owner','admin','manager','sales','stock']));
CREATE POLICY soi_delete ON public.service_order_items FOR DELETE TO authenticated
  USING (store_id = get_my_store_id() AND get_my_role() = ANY (ARRAY['owner','admin','manager','stock']));

-- 4) status history
CREATE TABLE IF NOT EXISTS public.service_order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  service_order_id uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  actor_profile_id uuid,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sosh_os ON public.service_order_status_history(service_order_id, created_at DESC);

GRANT SELECT, INSERT ON public.service_order_status_history TO authenticated;
GRANT ALL ON public.service_order_status_history TO service_role;
ALTER TABLE public.service_order_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY sosh_select ON public.service_order_status_history FOR SELECT TO authenticated
  USING (store_id = get_my_store_id());
CREATE POLICY sosh_insert ON public.service_order_status_history FOR INSERT TO authenticated
  WITH CHECK (store_id = get_my_store_id());

-- 5) photos
CREATE TABLE IF NOT EXISTS public.service_order_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  service_order_id uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  caption text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sop_os ON public.service_order_photos(service_order_id);

GRANT SELECT, INSERT, DELETE ON public.service_order_photos TO authenticated;
GRANT ALL ON public.service_order_photos TO service_role;
ALTER TABLE public.service_order_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY sop_select ON public.service_order_photos FOR SELECT TO authenticated
  USING (store_id = get_my_store_id());
CREATE POLICY sop_insert ON public.service_order_photos FOR INSERT TO authenticated
  WITH CHECK (store_id = get_my_store_id());
CREATE POLICY sop_delete ON public.service_order_photos FOR DELETE TO authenticated
  USING (store_id = get_my_store_id() AND get_my_role() = ANY (ARRAY['owner','admin','manager']));

-- 6) payments
CREATE TABLE IF NOT EXISTS public.service_order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  service_order_id uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  method text NOT NULL,
  note text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  cash_entry_id uuid,
  receivable_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sop2_os ON public.service_order_payments(service_order_id);
CREATE INDEX IF NOT EXISTS idx_sop2_store ON public.service_order_payments(store_id, paid_at DESC);

GRANT SELECT, INSERT ON public.service_order_payments TO authenticated;
GRANT ALL ON public.service_order_payments TO service_role;
ALTER TABLE public.service_order_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY sop2_select ON public.service_order_payments FOR SELECT TO authenticated
  USING (store_id = get_my_store_id());
CREATE POLICY sop2_insert ON public.service_order_payments FOR INSERT TO authenticated
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() = ANY (ARRAY['owner','admin','manager','sales','finance']));

-- =====================================================
-- updated_at trigger
-- =====================================================
CREATE OR REPLACE FUNCTION public.so_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_so_updated_at ON public.service_orders;
CREATE TRIGGER trg_so_updated_at BEFORE UPDATE ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.so_set_updated_at();

-- =====================================================
-- RPC: create_service_order
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_service_order(
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := get_my_store_id();
  v_role text := get_my_role();
  v_user uuid := auth.uid();
  v_profile uuid;
  v_id uuid;
  v_next int;
  v_terms text;
BEGIN
  IF v_store IS NULL THEN RAISE EXCEPTION 'no store'; END IF;
  IF v_role NOT IN ('owner','admin','manager','sales','stock') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT id INTO v_profile FROM profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  SELECT COALESCE(MAX(os_number),0) + 1 INTO v_next
    FROM service_orders WHERE store_id = v_store;

  SELECT os_terms_text INTO v_terms FROM store_settings WHERE store_id = v_store LIMIT 1;

  INSERT INTO service_orders (
    store_id, os_number, customer_id, customer_name, customer_phone,
    device, brand, model, imei_serial, device_password, accessories,
    device_condition, reported_issue, internal_notes, priority,
    technician_profile_id, estimated_delivery, terms_snapshot, created_by
  ) VALUES (
    v_store, v_next,
    NULLIF(p_payload->>'customer_id','')::uuid,
    p_payload->>'customer_name',
    p_payload->>'customer_phone',
    p_payload->>'device',
    p_payload->>'brand',
    p_payload->>'model',
    p_payload->>'imei_serial',
    p_payload->>'device_password',
    p_payload->>'accessories',
    p_payload->>'device_condition',
    p_payload->>'reported_issue',
    p_payload->>'internal_notes',
    COALESCE(p_payload->>'priority','normal'),
    NULLIF(p_payload->>'technician_profile_id','')::uuid,
    NULLIF(p_payload->>'estimated_delivery','')::date,
    v_terms,
    v_profile
  ) RETURNING id INTO v_id;

  INSERT INTO service_order_status_history (store_id, service_order_id, from_status, to_status, note, actor_profile_id, actor_user_id)
  VALUES (v_store, v_id, NULL, 'aberta', 'OS criada', v_profile, v_user);

  INSERT INTO audit_logs (store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (v_store, v_profile, 'create', 'service_order', v_id, p_payload);

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_service_order(jsonb) TO authenticated;

-- =====================================================
-- RPC: recalc totals (internal)
-- =====================================================
CREATE OR REPLACE FUNCTION public.so_recalc_totals(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_labor numeric := 0;
  v_parts numeric := 0;
  v_disc numeric := 0;
  v_paid numeric := 0;
  v_total numeric := 0;
BEGIN
  SELECT COALESCE(SUM(total) FILTER (WHERE item_type='service'),0),
         COALESCE(SUM(total) FILTER (WHERE item_type='part'),0)
    INTO v_labor, v_parts
    FROM service_order_items WHERE service_order_id = p_id;

  SELECT discount, COALESCE((SELECT SUM(amount) FROM service_order_payments WHERE service_order_id = p_id),0)
    INTO v_disc, v_paid
    FROM service_orders WHERE id = p_id;

  v_total := GREATEST(v_labor + v_parts - COALESCE(v_disc,0), 0);

  UPDATE service_orders
    SET labor_amount = v_labor,
        parts_amount = v_parts,
        total_amount = v_total,
        paid_amount = v_paid,
        pending_amount = GREATEST(v_total - v_paid, 0)
    WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_recalc_totals(uuid) TO authenticated;

-- =====================================================
-- RPC: add part (consumes stock)
-- =====================================================
CREATE OR REPLACE FUNCTION public.so_add_part(
  p_os uuid, p_product uuid, p_qty integer, p_unit_price numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := get_my_store_id();
  v_role text := get_my_role();
  v_user uuid := auth.uid();
  v_profile uuid;
  v_prod RECORD;
  v_item uuid;
  v_mov uuid;
BEGIN
  IF v_role NOT IN ('owner','admin','manager','sales','stock') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_qty <= 0 THEN RAISE EXCEPTION 'qty must be > 0'; END IF;

  SELECT id INTO v_profile FROM profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  SELECT * INTO v_prod FROM products WHERE id = p_product AND store_id = v_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product not found'; END IF;
  IF v_prod.on_hand < p_qty THEN RAISE EXCEPTION 'insufficient stock'; END IF;

  UPDATE products SET on_hand = on_hand - p_qty WHERE id = p_product;

  INSERT INTO stock_movements (store_id, product_id, movement_type, qty, unit_cost, reference_type, reference_id, reason, created_by)
  VALUES (v_store, p_product, 'out', p_qty, v_prod.cost_price, 'service_order', p_os, 'Peça usada em OS', v_profile)
  RETURNING id INTO v_mov;

  INSERT INTO service_order_items (store_id, service_order_id, item_type, product_id, description, qty, unit_price, total, stock_movement_id, created_by)
  VALUES (v_store, p_os, 'part', p_product, v_prod.name, p_qty, p_unit_price, p_qty * p_unit_price, v_mov, v_profile)
  RETURNING id INTO v_item;

  PERFORM so_recalc_totals(p_os);
  RETURN v_item;
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_add_part(uuid, uuid, integer, numeric) TO authenticated;

-- =====================================================
-- RPC: add service (labor)
-- =====================================================
CREATE OR REPLACE FUNCTION public.so_add_service(
  p_os uuid, p_description text, p_qty numeric, p_unit_price numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := get_my_store_id();
  v_role text := get_my_role();
  v_user uuid := auth.uid();
  v_profile uuid;
  v_item uuid;
BEGIN
  IF v_role NOT IN ('owner','admin','manager','sales','stock') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT id INTO v_profile FROM profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  INSERT INTO service_order_items (store_id, service_order_id, item_type, description, qty, unit_price, total, created_by)
  VALUES (v_store, p_os, 'service', p_description, p_qty, p_unit_price, p_qty * p_unit_price, v_profile)
  RETURNING id INTO v_item;

  PERFORM so_recalc_totals(p_os);
  RETURN v_item;
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_add_service(uuid, text, numeric, numeric) TO authenticated;

-- =====================================================
-- RPC: remove item (reverses stock if part)
-- =====================================================
CREATE OR REPLACE FUNCTION public.so_remove_item(p_item uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := get_my_store_id();
  v_role text := get_my_role();
  v_user uuid := auth.uid();
  v_profile uuid;
  v_item RECORD;
BEGIN
  IF v_role NOT IN ('owner','admin','manager','stock') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT id INTO v_profile FROM profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  SELECT * INTO v_item FROM service_order_items WHERE id = p_item AND store_id = v_store;
  IF NOT FOUND THEN RAISE EXCEPTION 'item not found'; END IF;

  IF v_item.item_type = 'part' AND v_item.product_id IS NOT NULL THEN
    UPDATE products SET on_hand = on_hand + v_item.qty::int WHERE id = v_item.product_id;
    INSERT INTO stock_movements (store_id, product_id, movement_type, qty, reference_type, reference_id, reason, created_by)
    VALUES (v_store, v_item.product_id, 'in', v_item.qty::int, 'service_order', v_item.service_order_id, 'Estorno de peça (OS)', v_profile);
  END IF;

  DELETE FROM service_order_items WHERE id = p_item;
  PERFORM so_recalc_totals(v_item.service_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_remove_item(uuid) TO authenticated;

-- =====================================================
-- RPC: change status
-- =====================================================
CREATE OR REPLACE FUNCTION public.so_change_status(p_os uuid, p_status text, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := get_my_store_id();
  v_role text := get_my_role();
  v_user uuid := auth.uid();
  v_profile uuid;
  v_os RECORD;
BEGIN
  IF v_role NOT IN ('owner','admin','manager','sales','stock') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT id INTO v_profile FROM profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  SELECT * INTO v_os FROM service_orders WHERE id = p_os AND store_id = v_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS not found'; END IF;

  UPDATE service_orders
    SET status = p_status,
        delivered_at = CASE WHEN p_status = 'entregue' THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
        cancelled_at = CASE WHEN p_status = 'cancelada' THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END
    WHERE id = p_os;

  INSERT INTO service_order_status_history (store_id, service_order_id, from_status, to_status, note, actor_profile_id, actor_user_id)
  VALUES (v_store, p_os, v_os.status, p_status, p_note, v_profile, v_user);

  -- notify on key transitions
  IF p_status IN ('aguardando_aprovacao','aguardando_peca','pronta_retirada') THEN
    INSERT INTO notifications (store_id, type, severity, title, description, entity_type, entity_id, link, dedupe_key)
    VALUES (v_store, 'service_order_status', 'info',
            'OS #' || v_os.os_number || ' — ' || p_status,
            'Cliente: ' || v_os.customer_name,
            'service_order', p_os, '/os/' || p_os,
            'so_' || p_os || '_' || p_status)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_change_status(uuid, text, text) TO authenticated;

-- =====================================================
-- RPC: settle payment
-- =====================================================
CREATE OR REPLACE FUNCTION public.so_settle_payment(
  p_os uuid, p_amount numeric, p_method text, p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := get_my_store_id();
  v_role text := get_my_role();
  v_user uuid := auth.uid();
  v_profile uuid;
  v_os RECORD;
  v_ledger uuid;
  v_cash uuid;
  v_pay uuid;
BEGIN
  IF v_role NOT IN ('owner','admin','manager','sales','finance') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  SELECT id INTO v_profile FROM profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  SELECT * INTO v_os FROM service_orders WHERE id = p_os AND store_id = v_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS not found'; END IF;

  SELECT id INTO v_ledger FROM cash_ledger WHERE store_id = v_store AND is_default = true LIMIT 1;
  IF v_ledger IS NULL THEN
    SELECT id INTO v_ledger FROM cash_ledger WHERE store_id = v_store LIMIT 1;
  END IF;

  IF v_ledger IS NOT NULL THEN
    INSERT INTO cash_entries (store_id, ledger_id, entry_type, category, amount, payment_method, reference_type, reference_id, description, created_by)
    VALUES (v_store, v_ledger, 'in', 'servico', p_amount, p_method, 'service_order', p_os,
            'Pagamento OS #' || v_os.os_number, v_profile)
    RETURNING id INTO v_cash;
  END IF;

  INSERT INTO service_order_payments (store_id, service_order_id, amount, method, note, cash_entry_id, created_by)
  VALUES (v_store, p_os, p_amount, p_method, p_note, v_cash, v_profile)
  RETURNING id INTO v_pay;

  PERFORM so_recalc_totals(p_os);
  RETURN v_pay;
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_settle_payment(uuid, numeric, text, text) TO authenticated;
