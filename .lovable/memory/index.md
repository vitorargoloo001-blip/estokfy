# Project Memory

## Core
SaaS loja de peças (Atibaia/SP). Multi-tenant por store_id. pt-BR.
Stack: React+TS+Shadcn, Lovable Cloud (Supabase). RPC create_sale_atomic transacional.
Design: sidebar escura, tema claro com azul primário (#3B82F6). Inter font.
Relatórios: SSOT é RPC `obter_relatorio_operacional_v2`. Filtro de "vendido" usa `sales.sale_date`, "recebido" usa `payments.paid_at`. NUNCA recalcular no frontend.

## Memories
- [DB Schema](mem://features/db-schema) — 17 tabelas: stores, profiles, categories, suppliers, customers, products, stock_movements, sales, sale_items, payments, deliveries, returns, return_items, cash_ledger, cash_entries, audit_logs, idempotency_keys
- [Auth & Roles](mem://features/auth-roles) — Roles: owner, admin, manager, sales, stock, finance, viewer. RLS via get_my_store_id()/get_my_role() security definer
- [Employees](mem://features/employees) — Página /funcionarios, RPCs list_employees/get_employee_performance/update_employee_role/set_employee_active, edge function employees-invite, TeamPerformanceCard no Dashboard
- [Reports v2](mem://features/reports-v2) — RPC única obter_relatorio_operacional_v2; sale_date vs created_at vs paid_at; vendas retroativas; src/lib/reportV2.ts

