-- =====================================================================
-- RECONCILIAÇÃO HISTÓRICA — TROCO CONTADO COMO RECEITA (M1)
-- Auditoria Estokfy 2026-09. NÃO APLICADO — arquivo de revisão.
--
-- REGRA DE NEGÓCIO (definida pelo dono do produto):
--   Valor entregue pelo cliente NÃO é receita. Recebimento líquido da
--   venda = valor da venda (net_total). Troco não é dinheiro que entrou
--   no caixa.
--
-- ESCOPO DESTE ARQUIVO: correção HISTÓRICA (dados já gravados). Não
-- mexe em RPC nem cria coluna nova — o mecanismo que causava o drift já
-- parou sozinho em 2026-08-19, quando create_sale_atomic passou a exigir
-- Σpagamentos = net_total (ver estokfy/CLAUDE.md, "Receivable balance
-- invariant"). Vendas novas já não conseguem mais gravar o troco como
-- amount_paid — o front só permite enviar pagamentos somando ao total.
--
-- ACHADO: 290 vendas históricas com amount_paid > net_total, drift total
-- R$2.533,00, 100% dos casos com o excedente também lançado em
-- cash_entries como entrada real. Dividido em dois grupos:
--
--   GRUPO A (268 vendas, R$1.773,00) — "limpo": exatamente 1 pagamento
--   não-pendente e 1 cash_entry por venda, cash_entry.amount ==
--   sales.amount_paid. Métodos: cash, pix, debit_card. Padrão consistente
--   de troco simples (cliente entregou mais que o valor da venda).
--   → Corrigido automaticamente por este script.
--
--   GRUPO B (22 vendas, R$760,00) — "revisão manual": múltiplos
--   pagamentos por venda, e/ou cash_entries ausente/parcial, e VÁRIAS
--   delas misturam method='credit' (abatimento/fidelidade — que por
--   definição já deveria estar fora do caixa, ver migration
--   20260617220000_fix_report_credit_noncash.sql) com pagamento em
--   dinheiro/pix. Isso não é só troco — pode ser interação com o sistema
--   de crédito/fidelidade, causa raiz diferente. Amostra confirmada:
--     03485db1: credit R$140 + cash R$35 (net_total R$170)
--     a982ee93: pix R$10 + credit R$80 (net_total R$80)
--     38a7e33a: pix R$145 + cash R$100 (net_total R$235)
--   → NÃO tocado por este script. Lista completa abaixo para você (ou
--   quem cuida do financeiro) decidir venda a venda. Aplicar a mesma
--   fórmula mecânica aqui seria adivinhar qual pagamento "errou" — dado
--   financeiro real, prefiro reportar a inventar.
--
-- SEGURANÇA / IDEMPOTÊNCIA:
--   - Todo o cálculo é refeito a partir do estado ATUAL do banco (não
--     usa uma lista de IDs fixada no arquivo) — rodar duas vezes é
--     seguro: na segunda vez, a tabela temporária fica vazia (drift já
--     é zero) e nenhum UPDATE encontra linha para tocar.
--   - Só toca as 3 tabelas envolvidas (payments, cash_entries, sales) e
--     só nas linhas que ainda têm o padrão exato do Grupo A. Nenhum
--     DELETE, nenhuma alteração de schema.
--   - Grava 1 linha de auditoria por venda corrigida em audit_logs, com
--     valor antes/depois, rastreável depois.
--   - Roda dentro de uma transação — se algo falhar no meio, nada é
--     aplicado (ROLLBACK automático).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Passo 0 — Snapshot do Grupo A no momento da execução (idempotente:
-- fica vazio se já foi corrigido antes).
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _troco_recon_snapshot ON COMMIT DROP AS
WITH inv AS (
  SELECT s.id AS sale_id, s.store_id, s.net_total, s.amount_paid, s.amount_pending,
         round((s.amount_paid + s.amount_pending - s.net_total)::numeric, 2) AS drift
  FROM public.sales s
  WHERE s.deleted_at IS NULL
    AND round((s.amount_paid + s.amount_pending - s.net_total)::numeric, 2) > 0.001
),
pay_agg AS (
  SELECT sale_id, count(*) AS n_pay, sum(amount) AS sum_pay
  FROM public.payments
  WHERE method <> 'pending' AND sale_id IN (SELECT sale_id FROM inv)
  GROUP BY sale_id
),
cash_agg AS (
  SELECT reference_id AS sale_id, count(*) AS n_cash, sum(amount) AS sum_cash
  FROM public.cash_entries
  WHERE reference_type = 'sale' AND reference_id IN (SELECT sale_id FROM inv)
  GROUP BY reference_id
)
SELECT inv.sale_id, inv.store_id, inv.net_total, inv.amount_paid, inv.drift
FROM inv
JOIN pay_agg  pa ON pa.sale_id = inv.sale_id
JOIN cash_agg ca ON ca.sale_id = inv.sale_id
WHERE pa.n_pay = 1 AND ca.n_cash = 1 AND ca.sum_cash = inv.amount_paid;

DO $$
DECLARE v_count int; v_total numeric;
BEGIN
  SELECT count(*), coalesce(sum(drift),0) INTO v_count, v_total FROM _troco_recon_snapshot;
  RAISE NOTICE 'Reconciliação de troco: % vendas a corrigir, R$ % de drift removido.', v_count, v_total;
  IF v_count = 0 THEN
    RAISE NOTICE 'Nada a fazer — já reconciliado (ou nenhuma venda no padrão Grupo A).';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Passo 1 — Corrige o valor do pagamento (remove o troco do que foi
-- contabilizado como recebido).
-- ---------------------------------------------------------------------
UPDATE public.payments p
SET amount = p.amount - t.drift
FROM _troco_recon_snapshot t
WHERE p.sale_id = t.sale_id
  AND p.method <> 'pending';

-- ---------------------------------------------------------------------
-- Passo 2 — Corrige o lançamento de caixa correspondente (o troco sai
-- do caixa registrado; o dinheiro que efetivamente ficou é só o da
-- venda).
-- ---------------------------------------------------------------------
UPDATE public.cash_entries ce
SET amount = ce.amount - t.drift
FROM _troco_recon_snapshot t
WHERE ce.reference_type = 'sale'
  AND ce.reference_id = t.sale_id;

-- ---------------------------------------------------------------------
-- Passo 3 — Corrige o total pago da venda (amount_pending já é 0 nessas
-- 268 — status 'paid' — então não precisa mexer nele nem no status).
-- ---------------------------------------------------------------------
UPDATE public.sales s
SET amount_paid = s.amount_paid - t.drift
FROM _troco_recon_snapshot t
WHERE s.id = t.sale_id;

-- ---------------------------------------------------------------------
-- Passo 4 — Trilha de auditoria (1 linha por venda corrigida).
-- ---------------------------------------------------------------------
INSERT INTO public.audit_logs (store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
SELECT
  t.store_id,
  NULL,
  'reconciliacao_troco_historico',
  'sale',
  t.sale_id,
  jsonb_build_object('amount_paid', t.amount_paid, 'net_total', t.net_total, 'drift', t.drift),
  jsonb_build_object('amount_paid', t.net_total, 'net_total', t.net_total, 'drift', 0)
FROM _troco_recon_snapshot t;

-- ---------------------------------------------------------------------
-- Passo 5 — Confirma que a invariante fechou para as vendas tocadas
-- (trava a transação inteira se alguma continuar divergente — não deixa
-- aplicar uma correção que não corrigiu de verdade).
-- ---------------------------------------------------------------------
DO $$
DECLARE v_remaining int;
BEGIN
  SELECT count(*) INTO v_remaining
  FROM public.sales s
  JOIN _troco_recon_snapshot t ON t.sale_id = s.id
  WHERE round((s.amount_paid + s.amount_pending - s.net_total)::numeric, 2) > 0.001;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Reconciliação falhou: % venda(s) ainda com drift após a correção — abortando.', v_remaining;
  END IF;
END $$;

COMMIT;

-- Verificação pós-aplicação:
-- SELECT count(*), coalesce(sum(round((amount_paid+amount_pending-net_total)::numeric,2)),0)
--   FROM sales WHERE deleted_at IS NULL
--    AND round((amount_paid+amount_pending-net_total)::numeric,2) > 0.001;
-- Esperado: 22 vendas, R$760,00 — só o Grupo B, que este script não toca.
