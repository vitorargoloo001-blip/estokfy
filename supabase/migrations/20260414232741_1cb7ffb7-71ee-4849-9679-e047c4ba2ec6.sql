-- Payment verifications table
CREATE TABLE public.payment_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  email text NOT NULL,
  plan_id text NOT NULL DEFAULT 'basic',
  expected_amount numeric NOT NULL DEFAULT 49.90,
  uploaded_file_url text,
  payment_status text NOT NULL DEFAULT 'pending',
  ai_confidence numeric,
  ai_reason text,
  extracted_name text,
  extracted_amount numeric,
  extracted_date text,
  extracted_pix_key text,
  match_result text,
  reviewer_type text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_verifications ENABLE ROW LEVEL SECURITY;

-- Users can see their own verifications
CREATE POLICY "pv_select_own" ON public.payment_verifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Users can insert their own verifications
CREATE POLICY "pv_insert_own" ON public.payment_verifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can update their own pending verifications (to upload file)
CREATE POLICY "pv_update_own" ON public.payment_verifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND payment_status IN ('pending', 'rejected'));

-- Super admin can see all
CREATE POLICY "pv_sa_select" ON public.payment_verifications
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- Super admin can update all
CREATE POLICY "pv_sa_update" ON public.payment_verifications
  FOR UPDATE TO authenticated
  USING (public.is_super_admin());

-- Storage bucket for receipts
INSERT INTO storage.buckets (id, name, public) VALUES ('payment-receipts', 'payment-receipts', false);

-- Users can upload their own receipts
CREATE POLICY "receipt_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-receipts' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Users can view their own receipts
CREATE POLICY "receipt_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'payment-receipts' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Super admin can view all receipts
CREATE POLICY "receipt_sa_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'payment-receipts' AND public.is_super_admin());

-- Update bootstrap function to create verification record and set store as pending
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

  SELECT email INTO v_user_email FROM auth.users WHERE id = p_auth_user_id;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'usuario_nao_encontrado';
  END IF;

  v_store_id := gen_random_uuid();
  v_profile_id := gen_random_uuid();
  v_ledger_id := gen_random_uuid();

  -- 1. Create store with access DISABLED until payment verified
  INSERT INTO public.stores (id, name, email, primary_color, secondary_color, access_enabled, subscription_status)
  VALUES (v_store_id, p_store_name, v_user_email, '#3B82F6', '#1E40AF', false, 'pending_payment');

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

  -- 5. Create default store settings
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
      'welcome_message','Olá! Sou seu assistente do sistema. Posso ajudar com vendas, estoque, clientes, entregas e configurações.',
      'contextual_help',true,'quick_suggestions',true
    ), v_profile_id),
    (v_store_id, 'security', jsonb_build_object(
      'audit_enabled',true,'session_timeout',480
    ), v_profile_id);

  -- 6. Create payment verification record
  INSERT INTO public.payment_verifications (store_id, user_id, email, plan_id, expected_amount)
  VALUES (v_store_id, p_auth_user_id, v_user_email, 'basic', 49.90);

  -- 7. Log bootstrap
  INSERT INTO public.audit_logs (store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (v_store_id, v_profile_id, 'bootstrap', 'store', v_store_id,
    jsonb_build_object('event','store_bootstrapped','categories_created',12,'settings_created',9,'payment_status','pending'));

  RETURN v_store_id;
END;
$$;