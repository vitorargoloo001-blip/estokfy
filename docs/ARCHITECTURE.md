# ARCHITECTURE.md — Estokfy

SaaS multi-tenant de gestão para loja de peças (Atibaia/SP). Português-BR.
Isolamento por `store_id` (cada usuário pertence a uma loja via `profiles`).

---

## 1. Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript 5 + Vite 5 |
| UI | shadcn/ui (Radix) + Tailwind CSS v3 + lucide-react |
| State / cache | @tanstack/react-query 5 |
| Forms | react-hook-form + zod |
| Roteamento | react-router-dom 6 |
| Animações | framer-motion |
| Charts | recharts |
| PDF | jspdf + jspdf-autotable |
| Excel | xlsx |
| Datas | date-fns |
| Offline | idb (IndexedDB) |
| Backend | Supabase (Postgres + Auth + Edge Functions + Storage + Realtime) |
| IA | Lovable AI Gateway (`google/gemini-3-flash-preview`) |

Build/teste: `vite`, `vitest`, `@playwright/test`, `eslint`.

---

## 2. Estrutura de pastas

```
src/
  App.tsx                  # Router + Providers raiz
  main.tsx                 # Bootstrap React
  index.css                # Tokens HSL do design system
  components/              # Componentes de UI
    ui/                    # shadcn primitives
    charts/
    service-orders/
    settings/
    AppLayout.tsx          # Layout autenticado (sidebar+topbar+outlet)
    AppSidebar.tsx         # Sidebar desktop (filtra por role)
    MobileNav.tsx          # Bottom-tab mobile
    MobileFAB.tsx          # FAB +Venda mobile
    TopBar.tsx             # Header (busca, notificações, perfil)
    NotificationBell.tsx
    GlobalSearch.tsx       # Cmd+K
    AISupportChat.tsx      # Drawer IA (lazy)
    OnboardingWizard.tsx
    InteractiveGuide.tsx   # (desativado por padrão)
    PageHeader.tsx, PageTip.tsx, ShimmerSkeleton.tsx
    RequireRoleRoute.tsx   # Guard de rota por role
    SaleDetailDialog.tsx, EditSaleDialog.tsx,
    SettlePaymentDialog.tsx, BatchSettlePaymentDialog.tsx,
    PayableFormDialog.tsx, AuditPeriodDialog.tsx,
    BulkProductDialog.tsx, BulkEditProductsDialog.tsx,
    Customer360Dialog.tsx, ProductHistoryDialog.tsx,
    ReceiptActions.tsx, ProductSearch.tsx, CustomerSearch.tsx,
    EmployeeFilter.tsx, SmartRecommendations.tsx,
    TeamPerformanceCard.tsx, OfflineIndicator.tsx
  contexts/
    AuthContext.tsx        # Sessão, profile, bootstrap, role
    OfflineContext.tsx     # Status online/offline + fila sync
  hooks/
    useAuth (via context), usePermissions, useStoreAccess,
    useSuperAdmin, useStoreSettings, usePrintSettings,
    useLoyalty, useNotifications, useLowStockAlert,
    useRealtimeSync, useKeyboardShortcuts, useBarcodeScanner,
    useCanViewCost, useDebouncedValue, useTheme, use-mobile,
    use-toast
  lib/
    api.ts                 # Wrappers de RPC
    reportV2.ts            # Relatórios (SSOT)
    reportPdf.ts, customerStatementPdf.ts, serviceOrderPdf.ts,
    financialReport.ts, receipt.ts, serviceOrderStatus.ts,
    stockMovementLabels.ts, aiIntents.ts,
    dateBR.ts, masks.ts, logger.ts, utils.ts,
    offlineDb.ts, syncEngine.ts
  integrations/supabase/
    client.ts              # auto-gerado (NUNCA editar)
    types.ts               # auto-gerado
  pages/
    Login, Dashboard, Products, Stock, Sales, NewSale,
    AccountsReceivable, AccountsPayable, IdleProducts,
    Customers, Loyalty, Deliveries, Returns, Finance,
    Reports, PurchasesReport, Settings, Categories,
    AuditHistory, PixelSettings, Employees, Help,
    PaymentVerification, AccessSuspended, NotFound,
    Presentation, DocsPixel,
    ServiceOrders/{Index,New,Detail}.tsx,
    super-admin/{Layout,Dashboard,Stores,StoreDetail,PaymentVerifications}.tsx
supabase/
  config.toml              # auto-gerado
  functions/               # Edge Functions Deno
  migrations/              # SQL versionado
```

---

## 3. Providers (em `App.tsx`)

`QueryClientProvider` → `TooltipProvider` → `Toaster`+`Sonner` →
`BrowserRouter` → `AuthProvider` → `OfflineProvider` → rotas.

- **QueryClient**: `staleTime 30s`, `gcTime 5min`, sem refetch on focus, retry 1.
- **AuthProvider**: monitora `supabase.auth`, carrega `profile`, executa `bootstrap_new_store` RPC quando perfil não existe.
- **OfflineProvider**: detecta `navigator.onLine`, enfileira mutations em IndexedDB (`offlineDb.ts`) e sincroniza via `syncEngine.ts`.

---

## 4. Componentes principais

- `AppLayout` — sidebar (desktop) + topbar + outlet + `AISupportChat` (lazy) + `MobileNav` + `MobileFAB`.
- `AppSidebar` — filtra itens pelo `role` via `canAccessRoute` (`lib/roleAccess.ts`).
- `RequireRoleRoute` — wrapper que redireciona usuários sem permissão para `/`.
- `TopBar` — busca global (Cmd+K), `NotificationBell`, atalho de loja, perfil.
- `NotificationBell` — usa `useNotifications` (alertas estoque baixo, vencimentos, etc.).
- `SaleDetailDialog`, `EditSaleDialog`, `SettlePaymentDialog`, `BatchSettlePaymentDialog` — fluxo financeiro/venda.
- `OnboardingWizard` — primeiro acesso, dismissable (localStorage).

---

## 5. Hooks customizados

| Hook | Função |
|---|---|
| `useAuth` | Sessão + profile + role + bootstrapping |
| `usePermissions` | Flags derivadas do role |
| `useStoreAccess` | Bloqueia loja suspensa / sem pagamento |
| `useSuperAdmin` | Checa `is_super_admin()` |
| `useStoreSettings` | Lê/grava `store_settings` |
| `usePrintSettings` | Configurações de impressão (recibo, A4) |
| `useLoyalty` | Programa de fidelidade |
| `useNotifications` | Stream de notificações |
| `useLowStockAlert` | Threshold do mínimo |
| `useRealtimeSync` | Channel postgres_changes — invalida queries |
| `useKeyboardShortcuts` | Atalhos globais |
| `useBarcodeScanner` | Captura keyboard wedge |
| `useCanViewCost` | Esconde custo conforme role |

---

## 6. Roteamento

Definido em `src/App.tsx`. Rotas autenticadas dentro de `<AppLayout>`,
guardadas por `RequireRoleRoute` + `canAccessRoute(role, path)`.

Rotas públicas: `/login`, `/docs/pixel`, `/apresentacao`.
Rotas restritas a estado: `/verificacao-pagamento`, `/acesso-suspenso`.
Rotas Super Admin: `/super-admin/*` (somente emails em `system_admins`).

---

## 7. Design System

- Cores definidas em HSL em `src/index.css` (tokens `--background`, `--primary`, etc.).
- Tailwind config em `tailwind.config.ts` consome os tokens.
- Tema: claro com primário azul `#3B82F6`. Sidebar escura. Fonte Inter.
- Nunca usar classes Tailwind de cor crua nos componentes — usar tokens semânticos.

---

## 8. Offline / PWA

- IndexedDB via `idb` em `lib/offlineDb.ts`.
- `OfflineContext` detecta online/offline.
- `syncEngine.ts` reprocessa mutations enfileiradas.
- `OfflineIndicator` exibe banner.

---

## 9. IA (Lovable AI Gateway)

- Drawer `AISupportChat` no `AppLayout`.
- Edge function `ai-support-chat` (modelo `google/gemini-3-flash-preview`, temp 0.2, 600 tokens).
- Ações suportadas (com confirmação): `sales-create`, `stock-adjust`, `returns-create`, `reports-summary`.
- Tabelas: `ai_conversations`, `ai_messages`, `ai_events`, `ai_handoffs`, `ai_training_data`.
