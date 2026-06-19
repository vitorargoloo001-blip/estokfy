import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { countPending } from '@/lib/offlineDb';
import { runSync, onSyncChange } from '@/lib/syncEngine';

export type ConnStatus = 'online' | 'offline';
export type SyncStatus = 'idle' | 'syncing' | 'done' | 'error';

interface OfflineContextType {
  connStatus: ConnStatus;
  syncStatus: SyncStatus;
  pendingCount: number;
  triggerSync: () => Promise<void>;
  isOffline: boolean;
}

const OfflineContext = createContext<OfflineContextType>({
  connStatus: 'online',
  syncStatus: 'idle',
  pendingCount: 0,
  triggerSync: async () => {},
  isOffline: false,
});

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [connStatus, setConnStatus] = useState<ConnStatus>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online'
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [pendingCount, setPendingCount] = useState(0);

  // Track online/offline
  useEffect(() => {
    const goOnline = () => setConnStatus('online');
    const goOffline = () => setConnStatus('offline');
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Listen to sync engine events
  useEffect(() => {
    const unsub = onSyncChange((status, pending) => {
      setSyncStatus(status);
      setPendingCount(pending);
    });
    return unsub;
  }, []);

  // Refresh pending count periodically
  useEffect(() => {
    const refresh = async () => setPendingCount(await countPending());
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, []);

  const triggerSync = useCallback(async () => {
    if (connStatus === 'offline') return;
    await runSync();
    setPendingCount(await countPending());
  }, [connStatus]);

  return (
    <OfflineContext.Provider value={{
      connStatus,
      syncStatus,
      pendingCount,
      triggerSync,
      isOffline: connStatus === 'offline',
    }}>
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline() {
  return useContext(OfflineContext);
}
