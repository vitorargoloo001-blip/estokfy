# Estokfy Connect — FASE 1: Relatório Técnico de Auditoria

**Data:** 2026-06-16
**Auditor:** Ultra (arquiteto/dev sênior)
**Banco de produção auditado:** `aimasistzxghumuxxuaw` (Supabase)
**App em produção:** https://estokfy-dibacell.netlify.app

---

## 0. Resumo executivo (a descoberta principal)

O Estokfy Connect **já foi praticamente todo construído** numa sessão anterior — porém **numa pasta diferente da que está no ar**, apontando para o banco **antigo** (Lovable). Ele nunca foi portado para o sistema migrado/em produção.

| | Pasta A — *Connect* | Pasta B — *Produção (no ar)* |
|---|---|---|
| Caminho | `ESTOKFY CLAUD\Sistema de Estoque` | `Sistema de Estoque (1)` |
| Banco (.env) | `fkmogaunoraeyxgpxxjq` (antigo/Lovable) | `aimasistzxghumuxxuaw` (atual) |
| Git | sim | não |
| Migrations | 78 | 64 |
| Tem Connect? | **SIM (scaffold ~90%)** | **NÃO (0%)** |
| Tem Trocas/Devoluções? | não | sim (entregue) |
| Deploy Netlify | não | **sim (este é o site real)** |

**Conclusão:** o trabalho da Fase 1 não é "começar do zero". É **PORTAR + RECONCILIAR + COMPLETAR + PUBLICAR** o que já existe, exatamente como pede a regra "utilize ao máximo a estrutura existente".

---

## 1. O que já existe (inventário do scaffold na Pasta A)

### 1.1 Banco de dados — 17 migrations prontas
- `store_modules_schema` / `store_modules_rpcs` — **sistema de licenciamento de módulos** (inclui `has_module()` = o helper `hasModule` pedido na Fase 3)
- `module_audit_logs` — auditoria de módulos
- `master_financial_system` / `master_financial_rpcs` — **Financeiro Impetus**
- `estokfy_connect_schema` / `estokfy_connect_rpc_core` — núcleo do Connect
- `connect_setup_progress` — progresso de configuração
- `bank_connections` — conexões bancárias (Fase 6)
- `bank_transactions` — transações (Fase 7)
- `reconciliation_matches` — motor de conciliação (Fase 8)
- `connect_audit_logs` — auditoria do Connect (Fase 12)
- `connect_licenses` / `fix_connect_licenses_rpcs` — licenças Connect
- `pluggy_integration` / `pluggy_rpc_helpers` — **integração Pluggy (Fase 5)**
- `super_admin_stores_rpc`

### 1.2 Edge Functions — 12 prontas (toda a camada servidor)
`manage-store-modules`, `connect-bank-oauth`, `connect-pluggy-auth-callback`,
`sync-bank-accounts`, `sync-bank-transactions`, `run-bank-reconciliation`,
`bank-webhook-handler`, `connect-webhook`, `connect-process-events`,
`refresh-bank-connection`, `connect-alert-email`, `log-connect-audit`.

### 1.3 Frontend — páginas e hooks
- **Super Admin:** `SuperAdminModuleLicensing.tsx` (licenças de módulos), `FinancialDashboard.tsx` (Impetus)
- **Connect (pages/Connect):** `Index`, `Setup`, `Connections`, `Transactions`, `Reconciliation`, `ConnectLicenses`, `Overview`, `Discrepancies`, `Audit`, `Settings` (+ duplicatas — ver item 3)
- **Hooks:** `useConnectModuleAccess`, `useConnectSetup`, `useBankConnections`, `useConnectBank`, `useConnectLicenses`, `useConnectAudit`, `useLogConnectAudit`, `useConnectRealtime`, `useConnectExport`

➡️ Os submenus pedidos (Visão Geral, Bancos, Transações, Conciliação, **Divergências**, **Auditoria**, **Configurações**) **já têm página correspondente** — só não foram ligados ao menu/rotas.

---

## 2. O que existe em produção hoje (banco `aimasistzxghumuxxuaw`)
- Connect / módulos / bancos / conciliação / Impetus: **NENHUM objeto existe** (0% aplicado).
- Super Admin **já funciona** e é a base certa para reaproveitar:
  - Tabela `system_admins (id, email, is_active, created_at)`
  - Função `is_super_admin()` → confere o e-mail do usuário logado contra `system_admins`
  - **`vitorargoloo001@gmail.com` JÁ está cadastrado e ativo** (e é o único). É a âncora perfeita para o trava de licenciamento da Fase 3.
  - Tabelas de log: `super_admin_logs`

---

## 3. Problemas encontrados (a corrigir antes/durante o port)

### 🔴 CRÍTICO — Segurança / Licenciamento
- **`toggle_store_module()` não restringe a quem altera módulos.** Ele só checa se a loja existe — **qualquer usuário autenticado poderia ativar/desativar módulos de qualquer loja.** A Fase 3 exige que **somente `vitorargoloo001@gmail.com`** faça isso.
  - **Correção:** todas as RPCs de mutação de licença passam a exigir `is_super_admin()`; senão, erro de permissão.

### 🟠 ALTO — Desvio de schema (migrations não aplicam "as is")
- As migrations da Pasta A foram escritas contra o **schema antigo (Lovable)** e fazem referências que **não existem em produção**. Ex.: `check_connect_enabled()` usa `stores.is_active`, mas em produção a coluna é `access_enabled` (não existe `stores.is_active`).
  - **Correção:** revisar as 17 migrations contra o schema real e aplicar de forma **incremental e validada**, nunca em bloco cego.

### 🟡 MÉDIO — Código duplicado / morto (a regra "não duplicar")
- Em `pages/Connect` há páginas completas (`Transactions` 11,9 KB, `Reconciliation` 9,9 KB, `Overview` 7,6 KB) **e** versões-stub `Connect*` (`ConnectTransactions` 1,3 KB, `ConnectReconciliation` 1,3 KB, `ConnectOverview` 3,7 KB), além de `Audit.tsx` vs `ConnectAudit.tsx`. Só as completas serão portadas; os stubs serão descartados.

### 🟡 MÉDIO — Taxonomia de módulos divergente
- Spec da Fase 3: **Core, Connect, OS, Analytics, Mobile.**
- Scaffold tem: `core, connect, loyalty, pixel` (CHECK constraint).
- Funcionalidades que realmente existem no app: Core, Connect, **Loyalty (Fidelidade)**, **Pixel**, **OS (Ordem de Serviço)**.
  - **Recomendação:** alinhar o licenciamento às funcionalidades reais (core, connect, os, loyalty, pixel) e deixar `analytics`/`mobile` como chaves reservadas para o futuro.

---

## 4. Estratégia de implementação aprovada (decorrente da auditoria)

1. **Reconciliar e aplicar** as 17 migrations no banco de produção, em ordem de dependência, validando cada uma (regra: não avançar sem validar).
2. **Corrigir a falha de segurança** do licenciamento (gate `is_super_admin()`).
3. **Portar** páginas + hooks + 12 edge functions da Pasta A para a Pasta B (produção), removendo duplicatas.
4. **Ligar** rotas (`App.tsx`), menu (`AppSidebar`), `roleAccess` e o gate de módulo (`hasModule`/`useConnectModuleAccess`).
5. **Pluggy:** configurar credenciais e publicar as functions. *(Depende de chave do cliente — ver bloqueio abaixo.)*
6. **Estados de UI** (loading / empty / error boundary) em todas as telas (Fase 2).
7. **Testes** de isolamento multi-loja + licença (Fase 13) e **documentação** (Fase 14).

### ⛔ Único bloqueio externo real
**Integração bancária real (Fases 5–7) precisa das credenciais Pluggy (`CLIENT_ID` + `CLIENT_SECRET`).** Só o dono da conta Pluggy consegue gerá-las. Sem elas, dá para publicar tudo em modo **sandbox/desligado**, mas não conectar banco real.

---

## 5. Riscos
- Aplicar migrations num **banco de produção em uso**: mitigado porque o Connect é **aditivo** (tabelas novas, invisíveis a quem não tem licença) e será validado passo a passo.
- Pasta A aponta para o **banco antigo** — nenhuma alteração será feita lá; ela serve apenas como **fonte do código** a ser portado.
