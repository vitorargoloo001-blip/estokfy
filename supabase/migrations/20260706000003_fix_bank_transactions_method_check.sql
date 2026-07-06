-- =====================================================================
-- Fix: bank_transactions.method CHECK constraint never included
-- 'credit_card' | 'debit_card' | 'money', even though the Pluggy sync
-- mapping (upsert_bank_transaction_pluggy, Block 4) and the sandbox
-- seeder both rely on those values. This would have broken real bank
-- imports for any credit/debit card or cash transaction, not just the
-- sandbox scenario generator (which is how this was caught).
-- =====================================================================

ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_method_check;

ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_method_check
  CHECK (method IN ('pix', 'ted', 'doc', 'cheque', 'boleto', 'credit_card', 'debit_card', 'money', 'other'));
