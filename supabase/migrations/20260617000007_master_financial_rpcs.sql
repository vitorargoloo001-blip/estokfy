-- Financial Management RPCs

-- Function: is_master_user() - Check if current user is vitorargoloo001@gmail.com
CREATE OR REPLACE FUNCTION public.is_master_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $FUNC$
  SELECT auth.email() = 'vitorargoloo001@gmail.com';
$FUNC$;

-- Function: get_financial_dashboard_kpis()
CREATE OR REPLACE FUNCTION public.get_financial_dashboard_kpis()
RETURNS TABLE (
  total_revenue NUMERIC,
  total_received NUMERIC,
  total_pending NUMERIC,
  active_clients BIGINT,
  active_stores BIGINT,
  active_modules BIGINT,
  overdue_payments BIGINT,
  ongoing_implementations BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $FUNC$
  SELECT
    COALESCE(SUM(mc.value_total), 0) as total_revenue,
    COALESCE(SUM(mc.value_paid), 0) as total_received,
    COALESCE(SUM(mc.value_total - mc.value_paid), 0) as total_pending,
    (SELECT COUNT(DISTINCT client_id) FROM master_contracts WHERE status != 'canceled') as active_clients,
    (SELECT COUNT(DISTINCT store_id) FROM master_contracts WHERE status != 'canceled') as active_stores,
    (SELECT COUNT(*) FROM master_contract_modules WHERE status = 'implemented') as active_modules,
    (SELECT COUNT(*) FROM master_payments WHERE status = 'overdue') as overdue_payments,
    (SELECT COUNT(*) FROM master_installation_status WHERE status = 'in_implementation') as ongoing_implementations
  FROM public.master_contracts mc
  WHERE mc.status != 'canceled';
$FUNC$;

-- Function: list_master_clients()
CREATE OR REPLACE FUNCTION public.list_master_clients()
RETURNS TABLE (
  id UUID,
  name TEXT,
  email TEXT,
  phone TEXT,
  city TEXT,
  active_stores BIGINT,
  total_contracted NUMERIC,
  status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $FUNC$
  SELECT
    mc.id,
    mc.name,
    mc.email,
    mc.phone,
    mc.city,
    (SELECT COUNT(*) FROM master_contracts WHERE client_id = mc.id AND status != 'canceled'),
    (SELECT COALESCE(SUM(value_total), 0) FROM master_contracts WHERE client_id = mc.id),
    CASE
      WHEN EXISTS (SELECT 1 FROM master_contracts WHERE client_id = mc.id AND status = 'canceled') THEN 'inactive'
      WHEN EXISTS (SELECT 1 FROM master_contracts WHERE client_id = mc.id AND status IN ('sold', 'in_implementation')) THEN 'active'
      ELSE 'pending'
    END as status
  FROM public.master_clients mc
  ORDER BY mc.created_at DESC;
$FUNC$;

-- Function: create_master_client()
CREATE OR REPLACE FUNCTION public.create_master_client(
  p_name TEXT,
  p_email TEXT,
  p_phone TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $FUNC$
DECLARE
  v_user_id UUID;
  v_new_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF NOT public.is_master_user() THEN
    RETURN QUERY SELECT NULL::UUID, false, 'Only master user can create clients';
    RETURN;
  END IF;
  
  INSERT INTO public.master_clients (name, email, phone, city, state, created_by, updated_by)
  VALUES (p_name, p_email, p_phone, p_city, p_state, v_user_id, v_user_id)
  RETURNING master_clients.id INTO v_new_id;
  
  INSERT INTO public.master_audit_logs (master_user_id, entity_type, entity_id, action, new_value)
  VALUES (v_user_id, 'client', v_new_id, 'created', jsonb_build_object('name', p_name, 'email', p_email));
  
  RETURN QUERY SELECT v_new_id, true, 'Client created successfully';
END;
$FUNC$;

-- Function: get_contract_details()
CREATE OR REPLACE FUNCTION public.get_contract_details(p_contract_id UUID)
RETURNS TABLE (
  contract_id UUID,
  client_name TEXT,
  client_email TEXT,
  store_name TEXT,
  plan TEXT,
  value_total NUMERIC,
  value_paid NUMERIC,
  status TEXT,
  modules JSONB,
  payments JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $FUNC$
  SELECT
    mc.id,
    mcl.name,
    mcl.email,
    COALESCE(s.trade_name, s.name),
    mc.plan,
    mc.value_total,
    mc.value_paid,
    mc.status,
    jsonb_agg(jsonb_build_object(
      'module_key', mcm.module_key,
      'value', mcm.value,
      'status', mcm.status,
      'activated_at', mcm.activated_at
    )),
    jsonb_agg(jsonb_build_object(
      'amount', mp.amount,
      'due_date', mp.due_date,
      'status', mp.status
    )),
    mc.created_at
  FROM public.master_contracts mc
  JOIN public.master_clients mcl ON mc.client_id = mcl.id
  JOIN public.stores s ON mc.store_id = s.id
  LEFT JOIN public.master_contract_modules mcm ON mc.id = mcm.contract_id
  LEFT JOIN public.master_payments mp ON mc.id = mp.contract_id
  WHERE mc.id = p_contract_id
  GROUP BY mc.id, mcl.name, mcl.email, COALESCE(s.trade_name, s.name), mc.plan, mc.value_total, mc.value_paid, mc.status, mc.created_at;
$FUNC$;

-- Function: activate_contract_module() - Links with store_modules
CREATE OR REPLACE FUNCTION public.activate_contract_module(
  p_contract_id UUID,
  p_module_key TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $FUNC$
DECLARE
  v_user_id UUID;
  v_store_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF NOT public.is_master_user() THEN
    RETURN QUERY SELECT false, 'Only master user can activate modules';
    RETURN;
  END IF;
  
  -- Get store_id from contract
  SELECT mc.store_id INTO v_store_id
  FROM public.master_contracts mc
  WHERE mc.id = p_contract_id;
  
  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Contract not found';
    RETURN;
  END IF;
  
  -- Update contract module status
  UPDATE public.master_contract_modules
  SET status = 'implemented', activated_at = now(), activated_by = v_user_id, updated_at = now()
  WHERE contract_id = p_contract_id AND module_key = p_module_key;
  
  -- Activate in store_modules (licensing system)
  PERFORM public.toggle_store_module(v_store_id, p_module_key, true, NULL);
  
  -- Log action
  INSERT INTO public.master_audit_logs (master_user_id, entity_type, entity_id, action, new_value)
  VALUES (v_user_id, 'module', p_contract_id, 'activated', jsonb_build_object('module', p_module_key, 'store', v_store_id));
  
  RETURN QUERY SELECT true, 'Module activated successfully';
END;
$FUNC$;

-- Function: record_payment()
CREATE OR REPLACE FUNCTION public.record_payment(
  p_payment_id UUID,
  p_payment_date DATE,
  p_payment_method TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $FUNC$
DECLARE
  v_user_id UUID;
  v_amount NUMERIC;
  v_contract_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF NOT public.is_master_user() THEN
    RETURN QUERY SELECT false, 'Only master user can record payments';
    RETURN;
  END IF;
  
  -- Get payment amount and contract
  SELECT mp.amount, mp.contract_id INTO v_amount, v_contract_id
  FROM public.master_payments mp
  WHERE mp.id = p_payment_id;
  
  -- Update payment
  UPDATE public.master_payments
  SET status = 'paid', payment_date = p_payment_date, payment_method = p_payment_method, updated_at = now(), updated_by = v_user_id
  WHERE id = p_payment_id;
  
  -- Update contract total paid
  UPDATE public.master_contracts
  SET value_paid = value_paid + v_amount, updated_at = now(), updated_by = v_user_id
  WHERE id = v_contract_id;
  
  -- Log
  INSERT INTO public.master_audit_logs (master_user_id, entity_type, entity_id, action, new_value)
  VALUES (v_user_id, 'payment', p_payment_id, 'recorded', jsonb_build_object('amount', v_amount, 'date', p_payment_date));
  
  RETURN QUERY SELECT true, 'Payment recorded successfully';
END;
$FUNC$;
