-- Impetus Internal Financial Management System
-- Master-only access for vitorargoloo001@gmail.com

-- Master Clients Table
CREATE TABLE IF NOT EXISTS public.master_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  city TEXT,
  state TEXT,
  document TEXT UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id)
);

-- Master Contracts Table
CREATE TABLE IF NOT EXISTS public.master_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.master_clients(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'pro', 'enterprise')),
  value_total NUMERIC(10,2) NOT NULL,
  value_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
  installments_count INTEGER,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'sold' CHECK (status IN ('sold', 'awaiting_payment', 'in_implementation', 'implemented', 'paused', 'canceled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id)
);

-- Contract Modules (which modules are in each contract)
CREATE TABLE IF NOT EXISTS public.master_contract_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.master_contracts(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL CHECK (module_key IN ('core', 'connect', 'loyalty', 'pixel')),
  value NUMERIC(10,2),
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'sold' CHECK (status IN ('sold', 'awaiting_payment', 'in_implementation', 'implemented', 'paused', 'canceled')),
  activated_at TIMESTAMPTZ,
  activated_by UUID REFERENCES public.profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (contract_id, module_key)
);

-- Payments Table
CREATE TABLE IF NOT EXISTS public.master_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.master_contracts(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  due_date DATE NOT NULL,
  payment_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'canceled')),
  payment_method TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id)
);

-- Installation Status
CREATE TABLE IF NOT EXISTS public.master_installation_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.master_contracts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'sold' CHECK (status IN ('sold', 'awaiting_payment', 'in_implementation', 'implemented', 'paused', 'canceled')),
  progress_percent INTEGER DEFAULT 0,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  responsible_name TEXT,
  responsible_email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id)
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS public.master_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_user_id UUID NOT NULL REFERENCES public.profiles(id),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_master_contracts_client 
  ON public.master_contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_master_contracts_store 
  ON public.master_contracts(store_id);
CREATE INDEX IF NOT EXISTS idx_master_contracts_status 
  ON public.master_contracts(status);
CREATE INDEX IF NOT EXISTS idx_master_payments_contract 
  ON public.master_payments(contract_id);
CREATE INDEX IF NOT EXISTS idx_master_payments_status 
  ON public.master_payments(status);
CREATE INDEX IF NOT EXISTS idx_master_payments_due_date 
  ON public.master_payments(due_date);
CREATE INDEX IF NOT EXISTS idx_master_audit_logs_date 
  ON public.master_audit_logs(created_at DESC);

-- RLS Policies
ALTER TABLE public.master_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_contract_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_installation_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_audit_logs ENABLE ROW LEVEL SECURITY;

-- Master user only access (vitorargoloo001@gmail.com = specific auth user)
-- Get master user ID from auth.users where email = 'vitorargoloo001@gmail.com'
-- For now, use service_role for all tables

CREATE POLICY "master_only_clients" ON public.master_clients
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true);

CREATE POLICY "deny_all_clients" ON public.master_clients
  AS RESTRICTIVE FOR ALL
  TO authenticated
  USING (false);

CREATE POLICY "master_only_contracts" ON public.master_contracts
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true);

CREATE POLICY "deny_all_contracts" ON public.master_contracts
  AS RESTRICTIVE FOR ALL
  TO authenticated
  USING (false);

CREATE POLICY "master_only_modules" ON public.master_contract_modules
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true);

CREATE POLICY "deny_all_modules" ON public.master_contract_modules
  AS RESTRICTIVE FOR ALL
  TO authenticated
  USING (false);

CREATE POLICY "master_only_payments" ON public.master_payments
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true);

CREATE POLICY "deny_all_payments" ON public.master_payments
  AS RESTRICTIVE FOR ALL
  TO authenticated
  USING (false);

CREATE POLICY "master_only_installation" ON public.master_installation_status
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true);

CREATE POLICY "deny_all_installation" ON public.master_installation_status
  AS RESTRICTIVE FOR ALL
  TO authenticated
  USING (false);

CREATE POLICY "master_only_audit" ON public.master_audit_logs
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true);

CREATE POLICY "deny_all_audit" ON public.master_audit_logs
  AS RESTRICTIVE FOR ALL
  TO authenticated
  USING (false);
