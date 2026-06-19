import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface SyncQueueItem {
  id: string;
  table: string;
  action: 'insert' | 'update' | 'upsert' | 'rpc';
  payload: Record<string, unknown>;
  status: 'pending' | 'syncing' | 'synced' | 'error';
  errorMessage?: string;
  createdAt: number;
  retries: number;
}

interface OfflineDBSchema extends DBSchema {
  products: { key: string; value: Record<string, unknown>; indexes: { 'by-store': string } };
  customers: { key: string; value: Record<string, unknown>; indexes: { 'by-store': string } };
  categories: { key: string; value: Record<string, unknown>; indexes: { 'by-store': string } };
  store_settings: { key: string; value: Record<string, unknown>; indexes: { 'by-store': string } };
  sync_queue: { key: string; value: SyncQueueItem; indexes: { 'by-status': string } };
  meta: { key: string; value: { key: string; value: unknown } };
}

const DB_NAME = 'loja-pecas-offline';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<OfflineDBSchema> | null = null;

export async function getDb(): Promise<IDBPDatabase<OfflineDBSchema>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<OfflineDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Products
      const products = db.createObjectStore('products', { keyPath: 'id' });
      products.createIndex('by-store', 'store_id');

      // Customers
      const customers = db.createObjectStore('customers', { keyPath: 'id' });
      customers.createIndex('by-store', 'store_id');

      // Categories
      const categories = db.createObjectStore('categories', { keyPath: 'id' });
      categories.createIndex('by-store', 'store_id');

      // Store settings
      const settings = db.createObjectStore('store_settings', { keyPath: 'id' });
      settings.createIndex('by-store', 'store_id');

      // Sync queue
      const queue = db.createObjectStore('sync_queue', { keyPath: 'id' });
      queue.createIndex('by-status', 'status');

      // Meta (last sync times, etc.)
      db.createObjectStore('meta', { keyPath: 'key' });
    },
  });

  return dbInstance;
}

// ─── Generic cache helpers ───

export async function cacheAll(
  storeName: 'products' | 'customers' | 'categories' | 'store_settings',
  storeId: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readwrite');

  // Clear old data for this store
  const idx = tx.store.index('by-store');
  let cursor = await idx.openCursor(storeId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }

  // Insert fresh data
  for (const row of rows) {
    await tx.store.put({ ...row, store_id: storeId });
  }
  await tx.done;

  // Record last sync time
  const metaDb = await getDb();
  await metaDb.put('meta', { key: `${storeName}_last_sync`, value: Date.now() });
}

export async function getCached(
  storeName: 'products' | 'customers' | 'categories' | 'store_settings',
  storeId: string,
): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  return db.getAllFromIndex(storeName, 'by-store', storeId);
}

// ─── Sync queue helpers ───

export async function addToSyncQueue(item: Omit<SyncQueueItem, 'id' | 'status' | 'createdAt' | 'retries'>): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.put('sync_queue', {
    ...item,
    id,
    status: 'pending',
    createdAt: Date.now(),
    retries: 0,
  });
  return id;
}

export async function getPendingItems(): Promise<SyncQueueItem[]> {
  const db = await getDb();
  return db.getAllFromIndex('sync_queue', 'by-status', 'pending');
}

export async function getErrorItems(): Promise<SyncQueueItem[]> {
  const db = await getDb();
  return db.getAllFromIndex('sync_queue', 'by-status', 'error');
}

export async function updateSyncItem(id: string, updates: Partial<SyncQueueItem>): Promise<void> {
  const db = await getDb();
  const item = await db.get('sync_queue', id);
  if (item) {
    await db.put('sync_queue', { ...item, ...updates });
  }
}

export async function removeSyncItem(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('sync_queue', id);
}

export async function countPending(): Promise<number> {
  const db = await getDb();
  return (await db.getAllFromIndex('sync_queue', 'by-status', 'pending')).length;
}
