
CREATE OR REPLACE FUNCTION public.bootstrap_new_store(
  p_auth_user_id uuid,
  p_store_name text DEFAULT 'Minha Loja',
  p_full_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_store_id uuid;
  v_profile_id uuid;
  v_ledger_id uuid;
  v_user_email text;
BEGIN
  -- Idempotent: if user already has a profile, return existing store
  SELECT store_id INTO v_store_id FROM public.profiles WHERE auth_user_id = p_auth_user_id LIMIT 1;
  IF v_store_id IS NOT NULL THEN
    RETURN v_store_id;
  END IF;

  -- Get user email from auth
  SELECT email INTO v_user_email FROM auth.users WHERE id = p_auth_user_id;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'usuario_nao_encontrado';
  END IF;

  v_store_id := gen_random_uuid();
  v_profile_id := gen_random_uuid();
  v_ledger_id := gen_random_uuid();

  -- 1. Create store
  INSERT INTO public.stores (id, name, email, primary_color, secondary_color)
  VALUES (v_store_id, p_store_name, v_user_email, '#3B82F6', '#1E40AF');

  -- 2. Create owner profile
  INSERT INTO public.profiles (id, store_id, auth_user_id, role, is_active, full_name)
  VALUES (v_profile_id, v_store_id, p_auth_user_id, 'owner', true, p_full_name);

  -- 3. Create default cash ledger
  INSERT INTO public.cash_ledger (id, store_id, name, is_default, currency)
  VALUES (v_ledger_id, v_store_id, 'Caixa Principal', true, 'BRL');

  -- 4. Create default categories
  INSERT INTO public.categories (store_id, name, color, sort_order) VALUES
    (v_store_id, 'Telas',          '#3B82F6',  1),
    (v_store_id, 'Baterias',       '#EF4444',  2),
    (v_store_id, 'Conectores',     '#8B5CF6',  3),
    (v_store_id, 'Tampas',         '#6B7280',  4),
    (v_store_id, 'Câmeras',        '#10B981',  5),
    (v_store_id, 'Flex',           '#F59E0B',  6),
    (v_store_id, 'Carcaças',       '#6366F1',  7),
    (v_store_id, 'Alto-falantes',  '#EC4899',  8),
    (v_store_id, 'Microfones',     '#14B8A6',  9),
    (v_store_id, 'Acessórios',     '#F97316', 10),
    (v_store_id, 'Ferramentas',    '#78716C', 11),
    (v_store_id, 'Outros',         '#9CA3AF', 12);

  -- 5. Create default store settings (9 categories)
  INSERT INTO public.store_settings (store_id, category, settings, updated_by) VALUES
    (v_store_id, 'preferences', jsonb_build_object(
      'theme','light','language','pt-BR','currency','BRL',
      'date_format','dd/MM/yyyy','timezone','America/Sao_Paulo',
      'pagination',20,'quick_mode',true,'sounds',false,'animations',true
    ), v_profile_id),
    (v_store_id, 'sales', jsonb_build_object(
      'require_customer',false,'require_payment',true,'allow_discount',true,
      'max_discount_pct',100,'default_payment','pix','print_receipt',false
    ), v_profile_id),
    (v_store_id, 'inventory', jsonb_build_object(
      'track_minimum',true,'default_minimum',5,'negative_stock',false,
      'auto_deduct_on_sale',true,'restock_on_return',true,'low_stock_alert',true
    ), v_profile_id),
    (v_store_id, 'finance', jsonb_build_object(
      'categories_income', '["Venda de produto","Ajuste de caixa","Reembolso","Outros recebimentos"]'::jsonb,
      'categories_expense', '["Compra de mercadoria","Aluguel","Energia","Internet","Funcionários","Transporte","Marketing","Impostos","Manutenção","Outros"]'::jsonb
    ), v_profile_id),
    (v_store_id, 'shipping', jsonb_build_object(
      'methods', '["pickup","correios","motoboy","transportadora","app_delivery"]'::jsonb,
      'default_method','pickup','track_cost',true
    ), v_profile_id),
    (v_store_id, 'returns', jsonb_build_object(
      'allow_returns',true,'require_reason',true,'auto_restock',false,'require_sale_link',false
    ), v_profile_id),
    (v_store_id, 'notifications', jsonb_build_object(
      'low_stock',true,'new_sale',false,'delivery_update',false,'email_notifications',false
    ), v_profile_id),
    (v_store_id, 'ai', jsonb_build_object(
      'enabled',true,'assistant_name','Assistente',
      'welcome_message','Olá! Sou seu assistente do sistema. Posso te ajudar com vendas, estoque, clientes, entregas e configurações.',
      'contextual_help',true,'quick_suggestions',true
    ), v_profile_id),
    (v_store_id, 'security', jsonb_build_object(
      'audit_enabled',true,'session_timeout',480
    ), v_profile_id);

  -- 6. Log bootstrap in audit
  INSERT INTO public.audit_logs (store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (v_store_id, v_profile_id, 'bootstrap', 'store', v_store_id,
    jsonb_build_object('event','store_bootstrapped','categories_created',12,'settings_created',9));

  RETURN v_store_id;
END;
$$;
