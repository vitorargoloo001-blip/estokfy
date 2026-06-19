---
name: Super Admin System
description: Global SaaS admin panel for vitorargoloo001@gmail.com - store access control, licensing, suspension
type: feature
---

## Tables
- `system_admins` — email, is_active. Seed: vitorargoloo001@gmail.com
- `super_admin_logs` — admin_user_id, store_id, action, before/after JSON, notes
- `stores` extended — plan, subscription_status, access_enabled, trial_ends_at, expires_at, notes

## Functions
- `is_super_admin()` — security definer, checks system_admins + auth.users
- `check_store_access(p_store_id)` — returns false if access_enabled=false or status in suspended/blocked/inactive

## RLS
- Super admin policies on stores (SELECT/UPDATE), profiles (SELECT), super_admin_logs (SELECT/INSERT)

## Frontend
- `/super-admin` — Dashboard with stats
- `/super-admin/stores` — Store list with search, filters, enable/disable actions
- `/super-admin/stores/:id` — Store detail with plan/status edit, action history
- `/acesso-suspenso` — Suspended access page for blocked stores
- `useSuperAdmin()` hook — checks is_super_admin RPC
- `useStoreAccess()` hook — checks check_store_access RPC
- Sidebar shows "Super Admin" link only for super admin users

## Edge Function Protection
- sales-create checks store access_enabled before processing
