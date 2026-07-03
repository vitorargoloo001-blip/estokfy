# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## This is the canonical working directory

This folder (`Sistema de Estoque (1)`) is the **only** copy of the Estokfy codebase that should be edited. There may be other local clones of the same GitHub repo (`vitorargoloo001-blip/estokfy`) lying around from earlier sessions — ignore them. All edits, commits, and pushes happen here. Before starting work, confirm `git remote -v` points to `vitorargoloo001-blip/estokfy` and `git status` matches what you expect; if you land in a different folder that also looks like this project, stop and reconcile before editing.

## Deep documentation lives in `docs/`

Read these before making non-trivial changes — they are detailed, accurate, and actively maintained, so don't re-derive what's already written down:

- `docs/ARCHITECTURE.md` — stack, folder structure, providers, routing, design system, offline/PWA
- `docs/DATABASE.md` — all 41 `public` tables with columns/types/FKs, ER diagram, indexes
- `docs/SUPABASE.md` — every RPC, Edge Function, trigger, view, and RLS convention
- `docs/BUSINESS_RULES.md` — auth flow, roles, permission rules, business logic per feature
- `docs/MODULES.md` — per-page breakdown: which tables/RPCs/edge functions/components each feature route uses
- `docs/MIGRATION_GUIDE.md` — how to stand the whole stack up from scratch on a fresh Supabase project
- `docs/connect/`, `docs/ai/`, `docs/multisegment/`, `docs/os/` — feature-specific technical reports for the Connect (bank reconciliation), AI copilot, multi-segment, and service-order (OS) modules

## Commands

```bash
npm install                 # deps not committed; required before first run
npm run dev                 # Vite dev server on :8080 (fixed in vite.config.ts)
npm run build                # production build -> dist/
npm run lint                 # eslint .
npm run test                  # vitest run (all unit tests, once)
npm run test:watch            # vitest watch mode
npx vitest run path/to/file.test.ts   # single unit test file
npx playwright test path/to/file.spec.ts   # single e2e test (uses lovable-agent-playwright-config)
```

Supabase (project ref `aimasistzxghumuxxuaw`, linked via `supabase link --project-ref aimasistzxghumuxxuaw`):

```bash
supabase db push                                  # apply pending migrations in supabase/migrations/
supabase functions deploy <name> --use-api          # deploy one edge function (no Docker on this machine — always pass --use-api)
supabase functions deploy --use-api                 # deploy all functions
supabase functions logs <name>
supabase gen types typescript --linked > src/integrations/supabase/types.ts   # regenerate types after schema changes
```

`supabase login` requires a real interactive terminal (fails with `LegacyLoginMissingTokenError` inside a non-TTY agent shell) — if not authenticated, ask the user to run it themselves in their own terminal window.

## Architecture essentials

Multi-tenant SaaS (Portuguese-BR), isolation by `store_id`. Every authenticated user has exactly one `profiles` row (`auth_user_id` → `store_id` + `role`). RLS is enabled on effectively every table; the standard policy shape is `store_id IN (SELECT store_id FROM profiles WHERE auth_user_id = auth.uid())`. Money-critical mutations (sales, stock, returns) go through `SECURITY DEFINER` RPCs called from Edge Functions with an `Idempotency-Key` header (see `create_sale_atomic`, `stock-adjust`, `sales-create`), not raw table writes from the frontend — follow that pattern for new financial/inventory operations.

Two independent gating layers on top of RLS:
- **Role-based** (core features): `src/lib/roleAccess.ts` (`canAccessRoute`) + `<RequireRoleRoute>` wrapper in `App.tsx`. Roles: `owner|admin|manager|sales|stock|finance|viewer`.
- **Module-based** (premium features like Connect): `store_modules` table (`module_key`, `is_active`, `deactivation_scheduled_at`) + `<RequireConnectModule>` wrapper, backed by `useConnectModuleAccess()` reading `AuthContext.storeModules` (loaded via `get_store_modules` RPC). `AuthContext`'s `modulesLoading` **must** start `true` — it gates whether `RequireConnectModule` shows a spinner or redirects; if it starts `false`, a cold page load (hard refresh, deep link) races ahead of the RPC and kicks the user back to `/` before modules ever load. (This exact regression happened once — see git history around `AuthContext.tsx` if it resurfaces.)

Super Admin (`/super-admin/*`) is a fully separate route tree gated by `is_super_admin()` (checks `system_admins` table by email), independent of both role and module gating.

`src/integrations/supabase/client.ts` and `types.ts` are auto-generated — never hand-edit; regenerate types with the command above after any schema change. Same for `supabase/config.toml`.

Offline-first: `src/lib/offlineDb.ts` (IndexedDB queue via `idb`) + `src/lib/syncEngine.ts` (replay on reconnect) + `OfflineContext` (online/offline + pending-sync status). Mutations made while offline are queued and flushed through the same edge-function/RPC path once connectivity returns.

## Hosting and deployment

Production is **Cloudflare Pages only**: `https://estokfy.pages.dev`, auto-deploys on every push to `main` via GitHub integration (no manual deploy step needed — just `git push`). Supabase Auth's Site URL and Redirect URLs must stay pointed at this domain. Netlify (`estokfy-dibacell.netlify.app`) and Surge (`estokfy.surge.sh`) are decommissioned — don't reintroduce references to either; if you see one, it's a leftover from before the hosting consolidation and should be fixed to point at `estokfy.pages.dev`.

Migrations are applied by pasting SQL into the Supabase SQL Editor as often as by `supabase db push` — when investigating "why doesn't this RPC/table exist," always check what's actually live in production (`information_schema`, `pg_proc`) rather than assuming the migrations folder is authoritative; the two have drifted before (objects applied live but never committed, or vice versa).

## Coding practice guidelines

These bias toward caution over speed; use judgment for trivial tasks.

1. **Think before coding.** State assumptions explicitly. If multiple interpretations exist, present them instead of picking silently. If something is unclear, stop and ask.
2. **Simplicity first.** Minimum code that solves the problem — no speculative features, no abstractions for single-use code, no error handling for impossible scenarios.
3. **Surgical changes.** Touch only what the task requires. Don't refactor or reformat unrelated code, even if you'd do it differently. Remove imports/variables that your own edit made unused; leave pre-existing dead code alone (mention it, don't delete it).
4. **Goal-driven execution.** Turn tasks into verifiable goals (e.g. "fix the bug" → "write a test that reproduces it, then make it pass") and loop until verified, rather than stopping at "looks right."
