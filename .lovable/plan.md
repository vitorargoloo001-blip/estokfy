# Módulo de Ordem de Serviço (OS)

Sistema completo para assistência técnica: entrada do aparelho → diagnóstico → reparo → entrega, totalmente integrado a estoque, financeiro, clientes e auditoria.

## 1. Banco de dados (migration)

Novas tabelas (multi-tenant por `store_id`, com RLS usando `get_my_store_id()` / `get_my_role()`):

- **`service_orders`** — número sequencial por loja, cliente, telefone, aparelho, marca, modelo, IMEI/serial, defeito relatado, estado do aparelho, senha, acessórios, prioridade, observações internas, técnico responsável (profile_id), data entrada, previsão entrega, status, valor mão-de-obra, desconto, valor pago, totais calculados, termos snapshot.
- **`service_order_items`** — itens da OS. Tipo: `service` (mão-de-obra livre) ou `part` (referencia `products.id`). Quantidade, valor unit, total. Ao inserir tipo `part`, baixa estoque e registra `stock_movements` via RPC.
- **`service_order_status_history`** — toda mudança de status: usuário, data/hora, status anterior, novo, observação.
- **`service_order_photos`** — fotos do aparelho em bucket privado `service-orders`.
- **`service_order_payments`** — pagamentos da OS (PIX, dinheiro, cartão, transferência, a prazo). Quando pago, cria `cash_entries`. Se ficar pendente, cria `accounts_receivable` (reaproveita estrutura existente).
- **`store_settings`** ganha campo `os_terms_text` (termos editáveis).

RPCs transacionais:
- `create_service_order(...)` — cria OS + número sequencial + histórico inicial.
- `add_service_order_part(os_id, product_id, qty, unit_price)` — valida estoque, insere item, baixa `products.on_hand`, grava `stock_movements` com `reference_type='service_order'`.
- `change_service_order_status(os_id, new_status, note)` — grava histórico + dispara notificação.
- `settle_service_order_payment(os_id, amount, method)` — cria payment + cash_entry; se total pago == total da OS, marca como `paid`; senão cria/atualiza receivable.

Todas as tabelas com `GRANT` para `authenticated` + `service_role`.

## 2. Rotas e navegação

- `/os` — painel principal (cards + lista com tabs por status)
- `/os/nova` — formulário de criação
- `/os/:id` — detalhe (cabeçalho, serviços/peças, pagamentos, histórico, fotos, PDF)
- Sidebar: nova seção "Operação → Ordem de Serviço" (ícone Wrench)
- `roleAccess.ts`: liberar `/os` para owner, admin, manager, sales (caixa), e nova role lógica "técnico" (mapeada como `stock` já existente — adicionar permissão).

## 3. Páginas / componentes

```text
src/pages/ServiceOrders/
  Index.tsx          ← painel com cards + tabs por status
  New.tsx            ← form de criação
  Detail.tsx         ← detalhe completo
src/components/service-orders/
  StatusBadge.tsx
  StatusChangeDialog.tsx
  AddPartDialog.tsx      (busca produto, baixa estoque)
  AddServiceDialog.tsx   (mão-de-obra livre)
  PaymentDialog.tsx
  PhotoUploader.tsx
  HistoryTimeline.tsx
  ServiceOrderPDF.tsx    (gera PDF via jsPDF, reaproveita padrão de receipt.ts)
src/lib/serviceOrderPdf.ts
src/hooks/useServiceOrders.ts
```

## 4. Painel principal

- Cards: OS abertas, em andamento, aguardando peça, finalizadas hoje, valor previsto, valor recebido (queries agregadas em paralelo).
- Tabs por status: Aberta, Em análise, Aguardando aprovação, Aguardando peça, Em reparo, Pronta p/ retirada, Entregue, Cancelada.
- Filtros: período, cliente, técnico, status, aparelho, forma de pagamento.

## 5. Integrações

- **Estoque**: peça adicionada → `stock_movements` (`movement_type='out'`, `reference_type='service_order'`) + decremento `products.on_hand`. Remoção → estorno.
- **Financeiro**: pagamento → `cash_entries` (entry_type=`in`, category=`servico`). Pendente → `accounts_receivable` vinculado ao cliente.
- **Cliente 360**: nova aba "Ordens de Serviço" no `Customer360Dialog` listando OSs do cliente.
- **Auditoria**: `audit_logs` recebe entradas em criação/edição/cancelamento/entrega.
- **Notificações**: insere em `notifications` para: aguardando aprovação, atrasada (previsão < hoje e não finalizada), pronta para retirada, aguardando peça, pagamento pendente. Trigger SQL ou criação manual ao mudar status.

## 6. PDF da OS

Gera A4 com: número OS, dados da loja, dados do cliente, aparelho/IMEI, defeito, lista de serviços e peças, valores, status, termos (snapshot), linhas de assinatura cliente + loja. Botões Imprimir / Baixar PDF / Reimprimir.

## 7. Termos

Campo `os_terms_text` em `store_settings` (texto padrão pré-preenchido conforme solicitado). Editável em `/configuracoes`.

## 8. Relatórios

Nova aba em `/relatorios` ("Serviços"):
- OS abertas/finalizadas no período
- OS por técnico (contagem + receita)
- Receita de serviços (mão-de-obra vs peças)
- Peças mais usadas em OS
- Serviços mais realizados
- Tempo médio de conclusão (entrega - entrada)
- OS aguardando peça

## 9. Permissões

`roleAccess.ts` libera `/os` para: owner, admin, manager, sales, stock (técnico). RLS controla edição:
- Criar/editar/finalizar: owner, admin, manager
- Mudar status, adicionar diagnóstico: owner, admin, manager, stock (técnico)
- Criar OS, receber pagamento, entregar: sales, owner, admin, manager

## 10. Storage

Bucket privado `service-orders` para fotos. Path: `{store_id}/{os_id}/{filename}`. RLS via policy em `storage.objects` checando `store_id` no path.

## Notas técnicas

- Numeração OS: `os_number int` com sequence por loja (RPC busca MAX+1 com lock).
- Status como enum text com check constraint.
- Toda escrita crítica via RPC `security definer` para garantir atomicidade.
- Reaproveita componentes existentes: `CustomerSearch`, `ProductSearch`, `PageHeader`, padrões de dialog do shadcn.

## Fora do escopo (para uma 2ª iteração se desejar)

- Envio automático de WhatsApp/SMS de notificação ao cliente
- Assinatura digital em tela (canvas) — por ora apenas linha no PDF
- App separado para técnico

Posso iniciar pela migration + tabelas + painel + criação de OS, e em seguida partir para itens (peças/serviços), pagamentos, PDF, relatórios e notificações. Confirma para começar?
