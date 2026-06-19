---
name: Employees Management
description: Per-store employee accounts with individual logins, role management, performance tracking and audit
type: feature
---

## Backend
- `profiles`: auth_user_id, store_id, role, is_active, full_name, phone
- Roles: owner, admin, manager, sales, stock, finance, viewer
- RPC `list_employees()`, `get_employee_performance(p_start,p_end)`, `update_employee_role`, `set_employee_active`
- Edge `employees-invite`: creates auth user with admin password (no email invite) + profile + audit
- Edge `employees-admin`: actions `update | reset_password | delete` (delete owner-only, deactivates profile + deletes auth user)
- All ops audited in `audit_logs`

## Frontend
- `/funcionarios` (`Employees.tsx`): Create/Edit/Reset password/Block/Delete dialogs + perf drawer
- `src/lib/roleAccess.ts`: per-role allowed routes
- `src/components/RequireRoleRoute.tsx`: route guard redirects unauthorized roles to `/`
- Sidebar filters items via `canAccessRoute`
- AuthContext blocks login of `is_active=false` profiles (auto signOut)
