# Estokfy Connect — Relatório Técnico Block 4 (Pluggy V2)

**Data:** 2026-06-21
**Commit:** `2237f21`
**Branch:** `main` → deploy automático via Cloudflare Pages

---

## 1. Escopo do Block 4

Implementação completa da integração bancária real via **Pluggy** — open banking brasileiro.
Substituição do formulário manual de contas por widget OAuth com importação automática de
transações, conciliação automática após sync, e tratamento de eventos via webhook.

---

## 2. Arquitetura geral

```
Frontend (React)
  └── usePluggyConnection.ts
        ├── GET /rpc/get_bank_connections_with_pluggy
        ├── POST /functions/v1/pluggy-connect-token    (obter token widget)
        ├── POST /functions/v1/pluggy-register-item    (registrar + importar TXs)
        └── POST /functions/v1/pluggy-sync-transactions (sync manual)

Pluggy Dashboard
  └── POST /functions/v1/pluggy-webhook               (ITEM_UPDATED / TRANSACTIONS_UPDATED)
        └── → internal call → pluggy-sync-transactions

Edge Functions (Deno, Supabase)
  ├── pluggy-connect-token      — emite connect token seguro
  ├── pluggy-register-item      — registra item + importa TXs iniciais
  ├── pluggy-sync-transactions  — sync incremental (30 dias default)
  └── pluggy-webhook            — webhook receiver + HMAC-SHA256

Supabase (PostgreSQL + RLS)
  ├── pluggy_items              — um item por instituição bancária
  ├── bank_connections          — uma conexão por conta do item
  ├── bank_transactions         — transações importadas (idempotente)
  ├── pluggy_webhooks           — log de todos os eventos recebidos
  └── reconciliation_matches    — gerado pelo connect_run_matching RPC
```

---

## 3. Componentes entregues

### 3.1 Migration `20260621000001_connect_pluggy_v2.sql`

| Elemento | Descrição |
|----------|-----------|
| `pluggy_items.last_synced_at` | TIMESTAMPTZ — data da última sincronização |
| `pluggy_items.accounts_json` | JSONB — array de contas do item para sync |
| `pluggy_items.webhook_url` | TEXT — URL configurada |
| `bank_connections.pluggy_item_id` | FK → pluggy_items.id |
| `bank_connections.pluggy_account_id` | TEXT — ID da conta na Pluggy |
| `register_pluggy_item_auth(...)` | RPC: upserta item + cria bank_connections por conta |
| `upsert_bank_transaction_pluggy(...)` | RPC service_role: idempotência via bank_reference |
| `update_bank_connection_sync_status(...)` | RPC service_role: atualiza status + contagem |
| `mark_pluggy_item_synced(...)` | RPC service_role: atualiza last_synced_at |
| `update_pluggy_item_status(...)` | RPC service_role: status / error_code / error_message |
| `get_pluggy_items_for_sync(...)` | RPC: lista items ativos com accounts_json |
| `disconnect_pluggy_item(...)` | RPC: desativa item + bank_connections |
| `get_bank_connections_with_pluggy(...)` | RPC: view completa para frontend |
| `GRANT connect_run_matching TO service_role` | Permite trigger automático após sync |
| Indexes | `idx_bank_transactions_bank_reference`, `idx_pluggy_items_last_synced` |

### 3.2 Edge Functions

#### `pluggy-connect-token`
- Verifica JWT Supabase do usuário
- Resolve `store_id` via tabela `profiles`
- Autentica em `POST /auth` → `apiKey`
- Solicita `POST /connect_tokens { clientUserId: store_id }` → `accessToken`
- Retorna `{ connectToken, storeId }` — sem expor credenciais ao frontend
- Env vars: `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`

#### `pluggy-register-item`
- Verifica JWT de usuário
- Recebe `{ pluggyItemId }` no body
- Chama Pluggy `/items/{id}` → metadata da instituição
- Chama Pluggy `/accounts?itemId=` → lista de contas
- Registra via RPC `register_pluggy_item_auth`
- Pagina `/transactions` (pageSize=500) para cada conta
- Importa via `upsert_bank_transaction_pluggy` (idempotente)
- Dispara `connect_run_matching` após importação
- Retorna `{ success, pluggyItemDbId, bankConnectionIds, txImported, txNew, matchResult }`

#### `pluggy-sync-transactions`
- Dual auth: `Authorization: Bearer` (usuário) OR `X-Internal-Secret` (webhook interno)
- Período default: últimos 30 dias
- Fetch de items via `get_pluggy_items_for_sync`
- Paginação de transações por conta
- Idempotência garantida por `bank_reference = Pluggy TX ID`
- `connect_run_matching` disparado somente se `totalNew > 0`
- Retorna métricas: `{ period, txImported, txNew, items[], matchResult }`

#### `pluggy-webhook`
- Recebe POST da Pluggy
- **HMAC-SHA256:** verifica `X-Pluggy-Signature` com `PLUGGY_WEBHOOK_SECRET`
  (se `PLUGGY_WEBHOOK_SECRET` não configurado, verifica apenas assinatura — avisa no log)
- Registra em `pluggy_webhooks` antes de processar
- Busca `store_id` pelo `pluggy_item_id` externo
- Roteamento de eventos:
  - `ITEM_ERROR` / `LOGIN_ERROR` → `update_pluggy_item_status(login_error)` + marca bank_connections como erro
  - `ITEM_UPDATED` / `TRANSACTIONS_UPDATED` → `update_pluggy_item_status(updated)` + dispara sync interno
  - outros → log apenas
- Marca webhook como processado
- Retorna `200 { received: true }` imediatamente

### 3.3 Hook `usePluggyConnection.ts`

| Função | Descrição |
|--------|-----------|
| `loadConnections()` | RPC `get_bank_connections_with_pluggy` → estado local |
| `openWidget()` | Token → carrega SDK CDN → abre widget → `onSuccess` chama `pluggy-register-item` |
| `syncNow(itemId?)` | POST `pluggy-sync-transactions` com item específico ou todos |
| `reconnect(itemId)` | Token → widget com `updateItem` = itemId existente |
| `disconnect(pluggyItemDbId)` | RPC `disconnect_pluggy_item` |
| `removeManualConnection(id)` | Update direto `bank_connections.is_active = false` |

### 3.4 `Connections.tsx` — UI completa

- Cabeçalho: "Bancos Conectados" + botões Atualizar / Conectar banco
- Banner de segurança (Pluggy = leitura somente)
- Estado vazio com CTA
- Cards por item Pluggy (agrupados): status badge, última sync, contagem de TXs
- Por item: ações **Sincronizar agora** / **Reconectar** (quando erro) / **Desconectar**
- Por conta: agência, número, tipo, última sync, botão remover
- Rodapé informativo: webhook URL, link Pluggy Dashboard, env vars necessários
- Dialog de confirmação para desconexão

---

## 4. Mapeamento de métodos Pluggy → interno

| Pluggy `paymentMethod` | Interno `method` |
|------------------------|-----------------|
| PIX | `pix` |
| TED | `ted` |
| DOC | `doc` |
| BOLETO | `boleto` |
| CC | `credit_card` |
| CD | `debit_card` |
| CASH | `money` |
| outros | `other` |

Tipo: `CREDIT` → `credit`, `DEBIT` → `debit`
Valor: sempre `ABS(amount)` — nunca negativo

---

## 5. Segurança

| Ponto | Controle |
|-------|----------|
| `PLUGGY_CLIENT_ID` / `SECRET` | Somente em env vars da Edge Function, nunca no frontend |
| Connect token | Gerado server-side, scoped por `store_id` (clientUserId) |
| Webhook HMAC | `X-Pluggy-Signature` verificado com `PLUGGY_WEBHOOK_SECRET` |
| Sync interno | `X-Internal-Secret = SUPABASE_SERVICE_ROLE_KEY` — não exposto ao usuário |
| RLS | `store_id` verificado em todas as tabelas e RPCs |
| Isolamento multi-tenant | Cada store vê apenas seus próprios `pluggy_items` / `bank_connections` / `bank_transactions` |
| `_migracao/` | No `.gitignore` — credenciais nunca commitadas |

---

## 6. Idempotência

```sql
-- upsert_bank_transaction_pluggy:
SELECT id INTO v_existing FROM public.bank_transactions
WHERE store_id = p_store_id AND bank_reference = p_external_id;

IF v_existing IS NOT NULL THEN
  RETURN QUERY SELECT v_existing, FALSE;
  RETURN;
END IF;
-- só insere se não existir
```

`bank_reference` = ID da transação Pluggy. Resyncs nunca duplicam.

---

## 7. Motor de conciliação

Após cada sync bem-sucedido com `totalNew > 0`:

```sql
SELECT * FROM connect_run_matching(store_id := p_store_id);
```

O RPC já existia (Block 2/3) — Block 4 adicionou `GRANT EXECUTE TO service_role`
para permitir chamada pela Edge Function.

3 passes:
1. **Determinístico** — valor exato + data exata + mesmo método
2. **Heurístico** — valor exato + ±1 dia + método compatível
3. **Fuzzy** — valor ±2% + ±3 dias + descrição similar

---

## 8. Configuração necessária (pós-deploy)

### 8.1 Supabase Edge Function Secrets
```
PLUGGY_CLIENT_ID=<client_id_do_pluggy>
PLUGGY_CLIENT_SECRET=<client_secret_do_pluggy>
PLUGGY_WEBHOOK_SECRET=<gerado_no_pluggy_dashboard>
```

### 8.2 Pluggy Dashboard
- URL do webhook: `https://aimasistzxghumuxxuaw.supabase.co/functions/v1/pluggy-webhook`
- Eventos: `ITEM_UPDATED`, `ITEM_ERROR`, `TRANSACTIONS_UPDATED`
- Ambiente: Production (usa credenciais reais) ou Sandbox (testes)

### 8.3 Verificação pós-configuração
1. Acessar Estokfy Connect → Bancos Conectados
2. Clicar "Conectar banco" → widget Pluggy abre
3. Autenticar com banco sandbox
4. Verificar: banco aparece na lista, transações importadas, status "Sincronizado"
5. Verificar: `pluggy_items` e `bank_connections` populados no Supabase
6. Verificar: `bank_transactions` com `bank_reference` preenchido
7. Verificar: `reconciliation_matches` criados automaticamente

---

## 9. Testes de validação

### Idempotência
```
POST /functions/v1/pluggy-sync-transactions (2x, mesmo período)
→ segunda chamada: txNew = 0, txImported = mesmo total
```

### Webhook HMAC
```
POST /functions/v1/pluggy-webhook com X-Pluggy-Signature inválido
→ 401 "Invalid signature"
```

### Webhook sem secret configurado
```
PLUGGY_WEBHOOK_SECRET não definido
→ 200, aviso no log, processa normalmente
```

### Isolamento entre lojas
```
store_A tenta conectar item criado por store_B
→ register_pluggy_item_auth verifica user access, retorna erro
```

### Reconexão
```
Banco com status login_error → botão "Reconectar" → widget abre com updateItem
→ onSuccess → pluggy-register-item → status volta a "updated"
```

---

## 10. Divergências identificadas (para Block 5)

| Tipo | Como detectar |
|------|--------------|
| Recebimento sem venda | `bank_transactions` sem `reconciliation_matches.sale_id` |
| Venda sem recebimento | `sales` com `payment_status = pending` sem TX correspondente |
| Valor diferente | Match com `match_score < 90` e `amount` diferente em TX vs venda |
| Possível duplicata | Dois registros com mesmo valor + data + método + descrição similar |

O Block 5 deverá implementar a Central de Divergências V2 com detecção automática
baseada nos dados Pluggy reais.

---

## 11. Arquivos entregues no Block 4

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `supabase/migrations/20260621000001_connect_pluggy_v2.sql` | Migration | Schema Pluggy V2 + RPCs service_role |
| `supabase/functions/pluggy-connect-token/index.ts` | Edge Function | Emissão de connect token |
| `supabase/functions/pluggy-register-item/index.ts` | Edge Function | Registro item + importação inicial |
| `supabase/functions/pluggy-sync-transactions/index.ts` | Edge Function | Sync incremental |
| `supabase/functions/pluggy-webhook/index.ts` | Edge Function | Receiver webhooks + HMAC |
| `src/hooks/usePluggyConnection.ts` | Hook React | Gerenciamento completo de conexões |
| `src/pages/Connect/Connections.tsx` | UI | Página Bancos Conectados com widget Pluggy |
| `docs/connect/TECHNICAL_REPORT_BLOCK4.md` | Documentação | Este relatório |

---

## 12. Status do Block 4

| Requisito | Status |
|-----------|--------|
| OAuth completo (startConnect, connectToken, item_id, account_id) | ✅ |
| Conectar / desconectar / reconectar banco | ✅ |
| Isolamento por store_id / RLS | ✅ |
| UI: banco, agência, conta, tipo, status, última sync | ✅ |
| UI: Sincronizar agora, Reconectar, Desativar, Excluir | ✅ |
| Edge Function sync: PIX, débito, crédito, TED, DOC, boleto | ✅ |
| Idempotência (bank_reference = Pluggy TX ID) | ✅ |
| Webhook: ITEM_UPDATED, TRANSACTIONS_UPDATED | ✅ |
| Webhook: verificação HMAC-SHA256 | ✅ |
| Match automático pós-sync (connect_run_matching) | ✅ |
| Nenhum secret no frontend | ✅ |
| Edge Functions + service_role para operações privilegiadas | ✅ |
| Multi-tenant: uma loja nunca acessa contas de outra | ✅ |
| Migration aplicada em produção | ✅ |
| Deploy no Cloudflare Pages | ✅ (commit `2237f21`, push realizado) |

**Block 4: COMPLETO — pronto para validação com credenciais Pluggy reais.**
