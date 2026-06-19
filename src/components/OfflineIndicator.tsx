import { useOffline } from '@/contexts/OfflineContext';
import { Wifi, WifiOff, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function OfflineIndicator() {
  const { connStatus, syncStatus, pendingCount, triggerSync, isOffline } = useOffline();

  // Don't render anything when online with nothing pending and idle
  if (connStatus === 'online' && pendingCount === 0 && syncStatus === 'idle') {
    return null;
  }

  // Briefly show "done" then hide
  if (connStatus === 'online' && pendingCount === 0 && syncStatus === 'done') {
    return (
      <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-white text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2">
        <CheckCircle2 className="h-4 w-4" />
        Sincronização concluída
      </div>
    );
  }

  return (
    <div
      className={cn(
        'fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg px-3 py-2 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2',
        isOffline ? 'bg-amber-600 text-white' : syncStatus === 'error' ? 'bg-destructive text-destructive-foreground' : 'bg-accent text-accent-foreground',
      )}
    >
      {isOffline ? (
        <>
          <WifiOff className="h-4 w-4" />
          <span>Você está offline</span>
          {pendingCount > 0 && (
            <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-xs">
              {pendingCount} {pendingCount === 1 ? 'pendente' : 'pendentes'}
            </span>
          )}
        </>
      ) : syncStatus === 'syncing' ? (
        <>
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>Sincronizando...</span>
        </>
      ) : syncStatus === 'error' ? (
        <>
          <AlertCircle className="h-4 w-4" />
          <span>Falha ao sincronizar alguns itens</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-1 h-6 px-2 text-xs text-white hover:bg-white/20"
            onClick={() => triggerSync()}
          >
            Tentar novamente
          </Button>
        </>
      ) : pendingCount > 0 ? (
        <>
          <Wifi className="h-4 w-4" />
          <span>{pendingCount} {pendingCount === 1 ? 'item pendente' : 'itens pendentes'}</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-1 h-6 px-2 text-xs text-white hover:bg-white/20"
            onClick={() => triggerSync()}
          >
            Sincronizar
          </Button>
        </>
      ) : null}
    </div>
  );
}
