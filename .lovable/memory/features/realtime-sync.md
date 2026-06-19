---
name: Realtime Sync
description: Supabase Realtime subscriptions + visibility/online refresh for live data sync between web and PWA
type: feature
---
## Setup
- 9 tables added to supabase_realtime publication: products, customers, categories, sales, stock_movements, deliveries, returns, store_settings, payments

## Hook (src/hooks/useRealtimeSync.ts)
- Subscribes to postgres_changes on all tables filtered by store_id
- Invalidates React Query cache per table on any change
- Refetches all queries when app returns from background (>30s away)
- Refetches all queries when coming back online (1.5s delay)
- Integrated in ProtectedRoutes (App.tsx)

## PWA
Already configured via vite-plugin-pwa with NetworkFirst caching, manifest, icons, and SW iframe guard.
