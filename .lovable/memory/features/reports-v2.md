---
name: Reports v2 Architecture
description: Sistema único de relatórios. Separa Vendido (sale_date) × Recebido (paid_at) × Pendente. Edge function reports-detailed e RPC obter_relatorio_operacional_v2 consumidos por Dashboard/Vendas/AR/Finance/Reports/PDF/CSV/IA.
type: feature
---

## Regra de datas (CRÍTICA)
- `sales.sale_date` — data comercial da operação. Filtro de TODOS os relatórios para "Vendido", "Vendas realizadas", "produtos vendidos". Suporta retroativa.
- `sales.registered_at` / `sales.created_at` — apenas auditoria.
- `payments.paid_at` — filtro de "Recebido"/"Caixa".
- Pendente = `amount_pending` em aberto das vendas REALIZADAS no período.

## Separação obrigatória (UI + dados)
1. **VENDIDO no período** (sale_date in [from,to]): count + net_total.
2. **RECEBIDO no caixa** (paid_at in [from,to]): total + breakdown:
   - `amount_received_from_period_sales` — vendas do período quitadas no período.
   - `amount_received_from_old_sales` — quitação de contas antigas (sale_date < from).
   - `amount_received_from_other` — pagamentos sem venda vinculada.
3. **PENDENTE** — apenas saldo em aberto, nunca soma ao recebido.

## Formas de pagamento — DOIS blocos
- **Bloco A — vendas realizadas** (`sales.payment_methods_realized`): base sale_date, inclui "a_prazo" para parte pendente.
- **Bloco B — recebimentos no caixa** (`sales.payment_methods`): base paid_at.
- Nunca exibir um único bloco misturando os dois (causa confusão tipo "8 vendas no cartão para 3 vendas reais").

## Alerta de divergência
Quando `amount_received > amount_sold`, mostrar:
"Este valor inclui recebimentos de vendas feitas em outros dias."

## Edge function `reports-detailed`
- Sales filtradas por `sale_date` (NÃO created_at).
- Payments traz `sales(sale_date,status,deleted_at)` para classificar origem.
- Descarta payments com `sales.deleted_at` ou status cancelled/refunded ou method='pending'.

## RPC v2 `obter_relatorio_operacional_v2`
Fonte única alternativa (JSON). Mesmas regras. Cliente: `src/lib/reportV2.ts`.

## create_sale_atomic
`p_sale_date` opcional permite retroativa. Marca em audit_logs quando `sale_date < hoje`.
