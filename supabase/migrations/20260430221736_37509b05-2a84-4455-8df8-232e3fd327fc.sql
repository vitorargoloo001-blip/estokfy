-- Atualizar constraint de payments.method para incluir todos os métodos suportados pelo frontend
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_check 
  CHECK (method = ANY (ARRAY['pix'::text, 'cash'::text, 'card'::text, 'credit_card'::text, 'debit_card'::text, 'transfer'::text, 'pending'::text, 'credit'::text]));