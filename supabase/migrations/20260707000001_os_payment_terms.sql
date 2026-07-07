-- =====================================================================
-- Condições de Pagamento na OS — habilitado só para a loja da MB
-- Assistência (marrassibalancas@gmail.com), mesmo padrão de
-- mb_customer_profile (20260703000001): flag em store_settings,
-- resolução da loja por e-mail no seed, RPC de toggle para Super Admin.
-- =====================================================================

-- 1) Coluna nova em service_orders (nullable, sem impacto em outras lojas)
ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS payment_terms text;

-- 2) Endpoint para ativação futura por qualquer loja (Super Admin)
CREATE OR REPLACE FUNCTION public.set_os_payment_terms_flag(
  p_store_id uuid,
  p_enabled  boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.store_settings (store_id, category, settings, updated_at)
  VALUES (p_store_id, 'os_payment_terms', jsonb_build_object('enable_payment_terms_field', p_enabled), now())
  ON CONFLICT (store_id, category) DO UPDATE
    SET settings   = jsonb_set(COALESCE(store_settings.settings, '{}'::jsonb), '{enable_payment_terms_field}', to_jsonb(p_enabled)),
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_os_payment_terms_flag(uuid, boolean) TO authenticated;

-- 3) Seed: habilita a flag para a loja da MB Assistência hoje (por e-mail).
--    Migration roda sem auth.uid(), então grava direto (não via RPC acima).
--    get_store_by_owner_email já existe (criada em 20260703000001).
DO $$
DECLARE
  v_store uuid;
BEGIN
  v_store := public.get_store_by_owner_email('marrassibalancas@gmail.com');

  IF v_store IS NOT NULL THEN
    INSERT INTO public.store_settings (store_id, category, settings, updated_at)
    VALUES (v_store, 'os_payment_terms', jsonb_build_object('enable_payment_terms_field', true), now())
    ON CONFLICT (store_id, category) DO UPDATE
      SET settings   = jsonb_set(COALESCE(store_settings.settings, '{}'::jsonb), '{enable_payment_terms_field}', 'true'::jsonb),
          updated_at = now();
  END IF;
END $$;

-- 4) create_service_order: grava payment_terms (mais um campo no INSERT
--    já existente, sem alterar o restante do comportamento).
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
    technician_profile_id, estimated_delivery, terms_snapshot, created_by,
    customer_doc_id, customer_state_registration, customer_address,
    customer_neighborhood, customer_city, customer_state, customer_zip_code,
    is_pro, warranty_days, warranty_description,
    travel_cost, toll_cost, km_driven, km_rate, other_costs, other_costs_desc,
    payment_terms
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
    v_profile,
    NULLIF(p_payload->>'customer_doc_id',''),
    NULLIF(p_payload->>'customer_state_registration',''),
    NULLIF(p_payload->>'customer_address',''),
    NULLIF(p_payload->>'customer_neighborhood',''),
    NULLIF(p_payload->>'customer_city',''),
    NULLIF(p_payload->>'customer_state',''),
    NULLIF(p_payload->>'customer_zip_code',''),
    COALESCE((p_payload->>'is_pro')::boolean, false),
    NULLIF(p_payload->>'warranty_days','')::int,
    NULLIF(p_payload->>'warranty_description',''),
    COALESCE((p_payload->>'travel_cost')::numeric, 0),
    COALESCE((p_payload->>'toll_cost')::numeric, 0),
    COALESCE((p_payload->>'km_driven')::numeric, 0),
    COALESCE((p_payload->>'km_rate')::numeric, 0),
    COALESCE((p_payload->>'other_costs')::numeric, 0),
    NULLIF(p_payload->>'other_costs_desc',''),
    NULLIF(p_payload->>'payment_terms','')
  ) RETURNING id INTO v_id;

  INSERT INTO service_order_status_history (store_id, service_order_id, from_status, to_status, note, actor_profile_id, actor_user_id)
  VALUES (v_store, v_id, NULL, 'aberta', 'OS criada', v_profile, v_user);

  INSERT INTO audit_logs (store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (v_store, v_profile, 'create', 'service_order', v_id, p_payload);

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_service_order(jsonb) TO authenticated;
