---
name: PWA Offline-First
description: Progressive Web App with IndexedDB cache and sync queue for offline operation
type: feature
---
## Setup
- vite-plugin-pwa with NetworkFirst caching for Supabase API
- Service worker guard: disabled in iframes and preview hosts
- Icons: pwa-192x192.png, pwa-512x512.png

## IndexedDB (src/lib/offlineDb.ts)
Stores: products, customers, categories, store_settings, sync_queue, meta
Auto-caches on successful online fetch via useOfflineData hook.

## Sync Engine (src/lib/syncEngine.ts)
- Processes pending queue items when back online
- Max 3 retries per item
- Supports insert, update, upsert, rpc actions

## Context (src/contexts/OfflineContext.tsx)
States: online/offline, idle/syncing/done/error, pendingCount

## Indicator (src/components/OfflineIndicator.tsx)
Fixed bottom-left banner showing offline status, pending count, sync progress.
