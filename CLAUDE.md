# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## This is the canonical working directory

This folder (`Desktop/Estokfy/estokfy`) is the **only** copy of the Estokfy codebase that should be edited. There may be other local clones of the same GitHub repo (`vitorargoloo001-blip/estokfy`) lying around from earlier sessions — ignore them. All edits, commits, and pushes happen here. Before starting work, confirm `git remote -v` points to `vitorargoloo001-blip/estokfy` and `git status` matches what you expect; if you land in a different folder that also looks like this project, stop and reconcile before editing.

## Deep documentation lives in `docs/`

Read these before making non-trivial changes — they are detailed, accurate, and actively maintained, so don't re-derive what's already written down:

- `docs/ARCHITECTURE.md` — stack, folder structure, providers, routing, design system, offline/PWA
- `docs/DATABASE.md` — `public` tables with columns/types/FKs, ER diagram, indexes. **Partially stale:** it says "41 tabelas"; production actually has 82 (verified 2026-09 against `information_schema`). The tables it does document are still accurate — it just never grew to cover the Connect/Master/AI waves. Treat production as authoritative for what exists.
- `docs/SUPABASE.md` — every RPC, Edge Function, trigger, view, and RLS convention. Also partially stale: the legacy Pluggy cluster it documents (`get_bank_connection_token`, `provider_webhooks`, `sync-bank-*`/`connect-*-oauth` Edge Functions) was deleted in 2026-09 — see "Legacy Pluggy cluster" below.
- `docs/BUSINESS_RULES.md` — auth flow, roles, permission rules, business logic per feature
- `docs/MODULES.md` — per-page breakdown: which tables/RPCs/edge functions/components each feature route uses
- `docs/MIGRATION_GUIDE.md` — how to stand the whole stack up from scratch on a fresh Supabase project
- `docs/FISCAL.md` — módulo Fiscal (controle de notas fiscais para declaração); read it before touching `fiscal_documents` — the "a nota nunca move dinheiro/estoque" invariant is structural, not incidental
- `docs/connect/`, `docs/ai/`, `docs/multisegment/`, `docs/os/` — feature-specific technical reports for the Connect (bank reconciliation), AI copilot, multi-segment, and service-order (OS) modules

## Commands

```bash
npm install                 # deps not committed; required before first run
npm run dev                 # Vite dev server on :8080 (fixed in vite.config.ts)
npm run build                # production build -> dist/
npm run lint                 # eslint .
npm run test                  # vitest run (all unit tests, once)
npm run test:watch            # vitest watch mode
npx tsc --noEmit -p .         # typecheck without emitting (no separate npm script for this)
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

**RPC overload footgun:** `CREATE OR REPLACE FUNCTION` with a *changed* parameter list creates a new overload instead of replacing the old one — Postgres then has to resolve ambiguity by argument count/type, and stale overloads with outdated logic can silently linger for months. This has caused real bugs twice (`create_sale_atomic` had 3 live overloads, `settle_sale_payment` had 2 — both cleaned up to a single live overload each). When editing an existing RPC's signature, check `select oid::regprocedure from pg_proc where proname = '<name>'` first and `DROP FUNCTION` the old signature in the same migration.

**Receivable balance invariant:** `sales.amount_paid + sales.amount_pending` must always equal `sales.net_total` — this is enforced with a hard `RAISE EXCEPTION` guard inside `create_sale_atomic` (checks `Σp_payments == net_total`) and `settle_sale_payment` (checks the new payment doesn't exceed the real `amount_pending`, read under `FOR UPDATE`), not by trusting the caller. A 2026-08 audit found 311 production sales where this had silently drifted (always overpaid, R$5–R$15) before the guards existed — traced to `create_sale_atomic` accepting a mismatched `p_payments` array and to `BatchSettlePaymentDialog.tsx`'s "recebimento agrupado" flow distributing payment based on a stale client snapshot of `amount_pending`. Any new RPC or edit that writes these two columns needs the same invariant check — don't add a new write path that skips it.

**Every new `SECURITY DEFINER` RPC needs an explicit guard *and* an explicit REVOKE.** `SECURITY DEFINER` bypasses RLS by design, and Postgres grants `EXECUTE` to `PUBLIC` on every `CREATE FUNCTION` — so a new RPC is callable by `anon` (the public anon key, no login) unless you say otherwise. A 2026-09 audit found 206 of 249 `SECURITY DEFINER` functions executable by `anon`, three of which leaked cross-tenant PII and contract/payment data to anyone holding the public key. Four reusable guard helpers now exist — `_assert_store_membership(store_id)`, `_assert_store_membership_or_admin(store_id)` (use this one when Super Admin also legitimately calls it, e.g. `get_store_modules`), `_assert_platform_admin()`, `_assert_bank_connection_access(connection_id)` — and every guarded RPC ends with `REVOKE EXECUTE ... FROM anon, PUBLIC`. Copy that shape; verify with `select has_function_privilege('anon', '<name>(<argtypes>)', 'EXECUTE')` before considering the migration done.

**Guards only work in `plpgsql`, never in `LANGUAGE sql`.** The obvious-looking `LANGUAGE sql` pattern — `WITH guard AS MATERIALIZED (SELECT _assert_...()) SELECT ... FROM guard, real_table` — is **not** a security barrier and was empirically proven to fail here: `MATERIALIZED` only prevents CTE re-evaluation, it does not force execution, and when the real table's scan returns zero rows for the caller the planner can skip probing the guard side entirely, so the function returns an empty result instead of raising. Verified with a `TEMP SEQUENCE` + `nextval()` counter: guard never fired against an empty-by-data table, always fired against a non-empty one. The only pattern that holds is `LANGUAGE plpgsql` with `PERFORM _assert_...();` as a statement *before* `RETURN QUERY` — imperative, no planner involved. All 26 guarded RPCs use this. Two conversion gotchas when moving an existing `LANGUAGE sql` function to `plpgsql`: (a) `RETURNS TABLE` column names become implicit variables, so an unqualified reference to a real column of the same name (`status`, `last_sync_at`) now errors as ambiguous — qualify every column in the body; (b) `RETURN QUERY` type-matches strictly where `LANGUAGE sql` was lenient, so `character varying` vs `text` mismatches that used to pass will now fail at call time (this surfaced three pre-existing latent bugs).

Two independent gating layers on top of RLS:
- **Role-based** (core features): `src/lib/roleAccess.ts` (`canAccessRoute`) + `<RequireRoleRoute>` wrapper in `App.tsx`. Roles: `owner|admin|manager|sales|stock|finance|viewer`.
- **Module-based** (premium features like Connect): `store_modules` table (`module_key`, `is_active`, `deactivation_scheduled_at`) + `<RequireConnectModule>` wrapper, backed by `useConnectModuleAccess()` reading `AuthContext.storeModules` (loaded via `get_store_modules` RPC). `AuthContext`'s `modulesLoading` **must** start `true` — it gates whether `RequireConnectModule` shows a spinner or redirects; if it starts `false`, a cold page load (hard refresh, deep link) races ahead of the RPC and kicks the user back to `/` before modules ever load. (This exact regression happened once — see git history around `AuthContext.tsx` if it resurfaces.)

Super Admin (`/super-admin/*`) is a fully separate route tree gated by `is_super_admin()` (checks `system_admins` table by email), independent of both role and module gating.

`src/integrations/supabase/client.ts` and `types.ts` are auto-generated — never hand-edit; regenerate types with the command above after any schema change. Same for `supabase/config.toml`.

Offline-first: `src/lib/offlineDb.ts` (IndexedDB queue via `idb`) + `src/lib/syncEngine.ts` (replay on reconnect) + `OfflineContext` (online/offline + pending-sync status). Mutations made while offline are queued and flushed through the same edge-function/RPC path once connectivity returns. `addToSyncQueue` currently has zero callers anywhere in `src/` — the queue plumbing exists but nothing enqueues a mutation into it yet, so don't assume any write path is actually offline-safe without checking first.

A `trg_sales_alert_payment_reverted` trigger on `public.sales` fires a `'critical'` row into `public.notifications` any time a row's `payment_status` leaves `'paid'` (regardless of which RPC caused it) — a broad safety net after a real incident where `EditSaleDialog` could silently un-pay a sale. It fires on *every* such transition, including legitimate ones (e.g. cancelling a return that had paid off a sale via `abatimento`), so a critical notification alone isn't evidence of a bug — check `sale_audit_logs`/`return_exchange_versions` for what actually caused it before assuming something broke.

**Legacy Pluggy cluster (removed 2026-09-08).** There were two parallel bank-integration implementations; the older Pluggy-direct one (7 Edge Functions — `connect-bank-oauth`, `connect-pluggy-auth-callback`, `connect-process-events`, `refresh-bank-connection`, `run-bank-reconciliation`, `sync-bank-accounts`, `sync-bank-transactions` — plus 9 RPCs including `get_bank_connection_token`, and the `provider_webhooks` table) was fully dead: never deployed, zero frontend callers, no `PLUGGY_*` secrets in production. It was deleted after verifying zero usage. The **live** Connect module (`connect-webhook`, `connect_*` tables, `docs/connect/`) is a different implementation and was untouched — don't conflate them, and don't resurrect the deleted names if you find them referenced in older docs.

## Hosting and deployment

Production is **Cloudflare Pages only**: `https://estokfy.pages.dev`, auto-deploys on every push to `main` via GitHub integration (no manual deploy step needed — just `git push`). Supabase Auth's Site URL and Redirect URLs must stay pointed at this domain. Netlify (`estokfy-dibacell.netlify.app`) and Surge (`estokfy.surge.sh`) are decommissioned — don't reintroduce references to either; if you see one, it's a leftover from before the hosting consolidation and should be fixed to point at `estokfy.pages.dev`.

Migrations are applied by pasting SQL into the Supabase SQL Editor as often as by `supabase db push` — when investigating "why doesn't this RPC/table exist," always check what's actually live in production (`information_schema`, `pg_proc`) rather than assuming the migrations folder is authoritative; the two have drifted before (objects applied live but never committed, or vice versa).

To confirm a push actually deployed: `npx wrangler pages deployment list --project-name=estokfy --json` lists deployments newest-first, but **as of wrangler 4.130.0 it no longer emits a `"Status"` field** (older instructions here said to check for `"Status": "Active"` — that check silently matches nothing now). Use it only to confirm a deployment exists for the latest commit hash, then verify the build actually served by fetching the site: `curl -s -o /dev/null -w '%{http_code}' https://estokfy.pages.dev` (and the deployment-specific `*.estokfy.pages.dev` URL). **Don't assume a push deployed just because it didn't error** — Cloudflare Pages builds run async after the git push returns, and can fail silently from the pusher's point of view (a `"Failure"` status here doesn't surface anywhere in the git/terminal output). This happened for real: a stale `bun.lockb` sitting in the repo since the very first commit (the project has only ever used npm — see Commands above) made Cloudflare's package-manager auto-detection pick `bun install --frozen-lockfile` over `npm ci`, which started failing the moment `package.json` next changed without a matching `bun.lockb` update, and silently pinned production to a stale build for days. Fixed by deleting `bun.lockb`; if deploys start failing again after a dependency change, check for its reappearance first.

For one-off production reads/writes that don't belong in a committed migration (data audits, test-data cleanup, ad-hoc verification), write a throwaway Node script into `_migracao/` (gitignored) that POSTs to the Supabase Management API (`https://api.supabase.com/v1/projects/{ref}/database/query`) with a personal access token, then delete the script when done — this directory already has examples of the pattern. Never hardcode a Management API token or session JWT outside `_migracao/`.

New signups require a confirmed email **and** manual Pix-payment approval (`payment_verifications`, `stores.access_enabled` — see `docs/BUSINESS_RULES.md`) before the app is usable, and Supabase's mailer has a low default rate limit, so signing up a throwaway QA account through the UI usually fails. To create one quickly: PATCH `mailer_autoconfirm` to `true` via the Management API's `/config/auth` endpoint (auth config, not a migration), sign up normally, then flip it back to `false` and directly `UPDATE stores SET access_enabled = true` + `payment_verifications.payment_status = 'approved_by_admin'` for that one store via a `_migracao/` script. Delete the test store the same way when done.

## Coding practice guidelines

These bias toward caution over speed; use judgment for trivial tasks.

1. **Think before coding.** State assumptions explicitly. If multiple interpretations exist, present them instead of picking silently. If something is unclear, stop and ask.
2. **Simplicity first.** Minimum code that solves the problem — no speculative features, no abstractions for single-use code, no error handling for impossible scenarios.
3. **Surgical changes.** Touch only what the task requires. Don't refactor or reformat unrelated code, even if you'd do it differently. Remove imports/variables that your own edit made unused; leave pre-existing dead code alone (mention it, don't delete it).
4. **Goal-driven execution.** Turn tasks into verifiable goals (e.g. "fix the bug" → "write a test that reproduces it, then make it pass") and loop until verified, rather than stopping at "looks right."
