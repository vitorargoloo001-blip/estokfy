import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/api';
import {
  getPendingItems,
  updateSyncItem,
  removeSyncItem,
  SyncQueueItem,
} from '@/lib/offlineDb';
import { logger } from '@/lib/logger';

const MAX_RETRIES = 3;

type SyncListener = (status: 'idle' | 'syncing' | 'done' | 'error', pending: number) => void;
const listeners: Set<SyncListener> = new Set();

export function onSyncChange(fn: SyncListener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function notify(status: 'idle' | 'syncing' | 'done' | 'error', pending: number) {
  listeners.forEach(fn => fn(status, pending));
}

let syncing = false;

export async function runSync(): Promise<{ synced: number; failed: number }> {
  if (syncing) return { synced: 0, failed: 0 };
  syncing = true;

  const items = await getPendingItems();
  if (items.length === 0) {
    syncing = false;
    notify('idle', 0);
    return { synced: 0, failed: 0 };
  }

  notify('syncing', items.length);
  let synced = 0;
  let failed = 0;

  for (const item of items) {
    try {
      await updateSyncItem(item.id, { status: 'syncing' });
      await processSyncItem(item);
      await removeSyncItem(item.id);
      synced++;
    } catch (err: any) {
      const retries = item.retries + 1;
      const status = retries >= MAX_RETRIES ? 'error' : 'pending';
      await updateSyncItem(item.id, {
        status: status as SyncQueueItem['status'],
        retries,
        errorMessage: err?.message || 'Erro desconhecido',
      });
      failed++;
      logger.error('[Sync] Item failed', { id: item.id, table: item.table, error: err?.message });
    }
  }

  syncing = false;
  const remaining = (await getPendingItems()).length;
  notify(failed > 0 ? 'error' : 'done', remaining);
  return { synced, failed };
}

async function processSyncItem(item: SyncQueueItem): Promise<void> {
  const { table, action, payload } = item;

  if (action === 'rpc') {
    // RPC calls go through edge functions
    const fnName = payload._function as string;
    const body = { ...payload };
    delete body._function;
    await invokeEdgeFunction(fnName, { body });
    return;
  }

  if (action === 'insert') {
    const { error } = await supabase.from(table as any).insert(payload as any);
    if (error) throw new Error(error.message);
    return;
  }

  if (action === 'update') {
    const id = payload.id as string;
    const rest = { ...payload };
    delete rest.id;
    const { error } = await supabase.from(table as any).update(rest as any).eq('id', id);
    if (error) throw new Error(error.message);
    return;
  }

  if (action === 'upsert') {
    const { error } = await supabase.from(table as any).upsert(payload as any);
    if (error) throw new Error(error.message);
    return;
  }

  throw new Error(`Unknown sync action: ${action}`);
}

// Auto-sync when coming back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    logger.info('[Sync] Back online, starting sync...');
    setTimeout(() => runSync(), 1500);
  });
}
