# Reconciliação de troco histórico (M1) — relatório

**ATUALIZAÇÃO 2026-09-08 — aplicado em produção.** Grupo A (268, R$1.773)
corrigido. Do Grupo B original, mais 6 vendas corrigidas após investigação de
causa raiz (ver seção "Reclassificação final" abaixo): 2 eram abatimento
antigo relabelado `credit` (sem tocar `loyalty_credits`), 2 tinham perna
alternativa preferida (sem tocar `loyalty_credits`), 2 exigiram devolver saldo
real ao cliente em `loyalty_credits` (auditado). Restam **16 vendas, R$730**
— 7 do subgrupo "perna espúria" (risco de reembolso real não descartado,
deixado propositalmente intocado a pedido do dono) + 9 genuinamente
ambíguas. Nenhuma correção mecânica aplicada a essas 16.


**290 vendas**, drift total **R$ 2.533,00**. Regra aplicada: valor entregue
pelo cliente não é receita — recebimento líquido = valor da venda.

## Grupo A — 268 vendas, R$ 1.773,00 — corrigido automaticamente

Padrão limpo: 1 pagamento não-pendente + 1 lançamento de caixa por venda, com
`cash_entries.amount == sales.amount_paid`. Métodos: cash (68), pix (197),
debit_card (3). SQL pronta: `RECONCILIACAO_TROCO_M1.sql` — reduz
`payments.amount`, `cash_entries.amount` e `sales.amount_paid` pelo valor do
troco em cada uma dessas 268 vendas, com auditoria e trava de conferência
automática. Não aplicada.

## Grupo B — 22 vendas, R$ 760,00 — **revisão manual, não corrigido**

Reclassificado na revisão pré-deploy em 3 subgrupos por causa provável — misturar
os 22 numa fórmula só seria adivinhar. Nenhum dos três foi corrigido.

### B1 — 7 vendas, `credit` envolvido — **não é troco, é outro bug**

Método `credit` é abatimento/fidelidade — por definição não deveria coexistir com
sobra de caixa. Isso é sintoma de uma interação diferente com o sistema de crédito
(possivelmente `use_loyalty_credit_atomic` aplicando o desconto errado, ou o valor
usado do crédito não bater com o que a venda precisava). Precisa de investigação
própria, separada do troco.

| Venda | Dia | Total venda | Pago | Diferença | Pagamentos |
|---|---|---:|---:|---:|---|
| a982ee93 | 04/07 | R$80,00 | R$90,00 | R$10,00 | credit 80 + pix 10 |
| 03485db1 | 10/07 | R$170,00 | R$175,00 | R$5,00 | credit 140 + cash 35 |
| df7d9286 | 20/07 | R$100,00 | R$105,00 | R$5,00 | credit 30 + pix 75 |
| 4ed63276 | 21/07 | R$145,00 | R$150,00 | R$5,00 | credit 150 (único) |
| 4f822089 | 29/07 | R$155,00 | R$160,00 | R$5,00 | cash 60 + credit 100 |
| c2b8a073 | 31/07 | R$180,00 | R$185,00 | R$5,00 | credit 185 (único) |
| 2087ce59 | 18/08 | R$90,00 | R$95,00 | R$5,00 | credit 95 (único) |

### B2 — 4 vendas, mesmo método repetido — **provável duplicidade de lançamento, não troco**

Duas ou mais entradas do MESMO método na mesma venda. Em `ddb815e8` e `fac78cc7`,
uma das entradas sozinha já bate exatamente com `net_total` — indício forte de que
a OUTRA entrada é um lançamento a mais (erro/duplicidade), não sobra de troco.
`95f45285` tem 4 entradas pix somando R$175 acima do total — desvio grande demais
pra ser troco de dinheiro físico (troco não existe em pix).

| Venda | Dia | Total venda | Pago | Diferença | Pagamentos |
|---|---|---:|---:|---:|---|
| 95f45285 | 21/05 | R$195,00 | R$370,00 | R$175,00 | pix 40 + pix 55 + pix 100 + pix 175 |
| ddb815e8 | 06/06 | R$480,00 | R$930,00 | R$450,00 | pix 450 + pix 480 (o 480 sozinho = net_total) |
| fac78cc7 | 12/08 | R$100,00 | R$110,00 | R$10,00 | cash 10 + cash 100 (o 100 sozinho = net_total) |
| e16d67a3 | 13/08 | R$90,00 | R$95,00 | R$5,00 | pix 20 + pix 75 |

### B3 — 11 vendas, 2 métodos diferentes, diferença redonda (R$5/10/15) — **provável troco, mas ambíguo qual perna absorveu**

Formato mais parecido com o Grupo A (cash/pix/card, diferença redonda), mas
dividido em 2 linhas de pagamento — não dá pra saber com certeza qual das duas
"errou" sem contexto adicional (ordem de digitação, por exemplo).

| Venda | Dia | Total venda | Pago | Diferença | Pagamentos |
|---|---|---:|---:|---:|---|
| 38a7e33a | 01/07 | R$235,00 | R$245,00 | R$10,00 | cash 100 + pix 145 |
| 749a0a02 | 03/07 | R$165,00 | R$170,00 | R$5,00 | cash 5 + pix 165 |
| 85bc246f | 13/07 | R$120,00 | R$130,00 | R$10,00 | cash 40 + pix 90 |
| ac063587 | 17/07 | R$160,00 | R$165,00 | R$5,00 | cash 150 + pix 15 |
| 01f35183 | 18/07 | R$75,00 | R$85,00 | R$10,00 | cash 15 + debit_card 70 |
| aed0ddf3 | 20/07 | R$95,00 | R$105,00 | R$10,00 | cash 100 + pix 5 |
| 913ae33c | 25/07 | R$110,00 | R$115,00 | R$5,00 | cash 5 + pix 110 |
| 85e79883 | 25/07 | R$200,00 | R$210,00 | R$10,00 | cash 200 + pix 10 |
| 138b8198 | 30/07 | R$115,00 | R$120,00 | R$5,00 | cash 50 + pix 70 |
| 1e0748e9 | 30/07 | R$380,00 | R$385,00 | R$5,00 | cash 25 + pix 360 |
| 5d89d93b | 18/08 | R$85,00 | R$90,00 | R$5,00 | cash 20 + pix 70 |

IDs truncados (8 primeiros caracteres) — peça o UUID completo se for investigar
uma venda específica; posso extrair.

## O que fazer com o Grupo B

Nenhum SQL corretivo escrito pra nenhum dos 3 subgrupos — teria que adivinhar
dado financeiro. Sugestão por subgrupo:
- **B1 (credit)**: investigar a lógica de aplicação de crédito primeiro; pode
  revelar mais casos além desses 7 que ainda não geraram `amount_paid > net_total`
  visível.
- **B2 (duplicidade)**: mais fácil de decidir — comparar com o histórico de
  auditoria (`sale_audit_logs`) de cada venda pra ver se uma das entradas foi
  claramente um erro de digitação repetido.
- **B3 (troco em 2 pernas)**: revisar venda a venda; posso aplicar a mesma
  correção do Grupo A assim que você (ou quem cuida do financeiro) confirmar qual
  perna de cada uma carrega o troco.

## Aplicação
`RECONCILIACAO_TROCO_M1.sql` — idempotente (recalcula tudo do estado atual do
banco a cada execução, seguro rodar mais de uma vez), roda em transação com
trava de conferência automática no final, grava 1 linha em `audit_logs` por
venda corrigida. Não aplicado — aguardando seu OK.
