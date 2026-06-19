# Estokfy Core — Auditoria de Consolidação (2026-06-17)

Auditoria das prioridades 1–3 (relatórios financeiros, vendas/contas a receber/financeiro, duplicação) + estado de 4 (OS) e 5 (carteira única).

## 1) Relatórios financeiros — BOM, com 1 correção
`get_financial_report_summary` é robusto: exclui vendas canceladas/excluídas (`sales_valid`), separa pagamentos "ignorados" (de vendas canceladas/excluídas), traz trilha de auditoria (`payments_used`, `payments_ignored`, `sales_ignored`) e **já detecta possíveis duplicatas** (`possible_duplicates`).

🔧 **Correção encontrada e preparada:** o abatimento de devolução grava um pagamento `method='credit'` (liquidação NÃO-caixa). O relatório contava `credit` como dinheiro recebido (`received.total` e `net_cash`), o que **inflava o caixa** sem entrada real. `use_loyalty_credit_atomic` usa DESCONTO (não pagamento), então `credit` em `payments` só vem do abatimento. Fix: excluir `method IN ('pending','credit')` das métricas de caixa do relatório. Migration `20260617220000_fix_report_credit_noncash.sql` — validada (rollback + execução real: relatório roda, `by_method` mostra só pix/cash/cartões). **Aguardando publicar.**

## 2) Vendas / Contas a Receber / Financeiro — CONSISTENTE
- **Contas a receber** = vendas com `payment_status IN ('pending','partial')` e `amount_pending>0`; vencidas via `due_date < hoje`. (Não há tabela separada; a dívida vive na venda — mesma base do abatimento.)
- **Recebido** = `payments` (métodos de caixa); **Caixa/Financeiro** = `cash_entries` (fonte da verdade do dinheiro). Abatimento NÃO cria `cash_entries` (correto — não há dinheiro).
- Vendas canceladas/excluídas e seus pagamentos são corretamente excluídos dos totais.

## 3) Duplicação — FORTEMENTE PROTEGIDO ✅
- **Criação de venda:** edge function `sales-create` exige `Idempotency-Key`, reserva em `idempotency_keys (store_id, idem_key)` único, devolve resultado em cache em retry, limpa em falha → **duplo-clique não cria venda duplicada.**
- **Pagamentos:** `payments_idem_key_uniq (store_id, idempotency_key)` + `payments_sale_dedup_uniq (sale_id, method, amount, paid_at_minute)` → bloqueia pagamento repetido no mesmo minuto.
- **Caixa:** `cash_entries_payment_uniq (payment_id)` + `cash_entries_sale_dedup_uniq (store_id, reference_type, reference_id, amount, occurred_at_minute)`.
- Relatório tem detector `possible_duplicates`.
- **Conclusão:** sem brecha de duplicação encontrada.
- 🧹 *Limpeza menor (opcional):* existem 3 sobrecargas de `create_sale_atomic` (6/7/8 args) — versões legadas; manter só a usada e remover as antigas.

## 4) Ordem de Serviço (OS) — JÁ EXISTE, precisa de auditoria dedicada
Há tabelas, páginas (`/os`, `/os/nova`, `/os/:id`) e RPCs (`create_service_order`, `so_add_service`, `so_add_part`, `so_settle_payment`, `so_change_status`, `so_remove_item`, trigger `so_set_updated_at`). Não é "do zero". Próximo passo: auditar fluxos (baixa de estoque das peças, pagamento, status, auditoria, vínculo com cliente/financeiro).

## 5) Carteira única do cliente — JÁ CONSOLIDADO
`loyalty_credits` é a carteira única, com `origin`:
- `loyalty` = fidelidade
- `devolucao` = crédito de devolução
- `troca` = vale-troca
Página `/creditos` (CustomerCredits) + RPC `customer_loyalty_summary` agregam saldo e histórico por cliente. Aplicação via `use_loyalty_credit_atomic` (desconto na venda). **Já é uma carteira só.** Opcional: aba "Carteira" no perfil do cliente unificando saldo + extrato.

## Pendências desta etapa
- Publicar a correção do relatório (`credit` não-caixa).
- (Opcional) remover sobrecargas legadas de `create_sale_atomic`.
- Auditoria dedicada da OS (#4).
- (Opcional) visão unificada "Carteira" no perfil do cliente (#5).
