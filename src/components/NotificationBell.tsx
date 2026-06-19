import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, AlertCircle, Info, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications, type Notification } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';

function iconFor(n: Notification) {
  if (n.severity === 'critical') return <AlertCircle className="h-4 w-4 text-destructive" />;
  if (n.severity === 'warning') return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <Info className="h-4 w-4 text-primary" />;
}

export default function NotificationBell() {
  const { items, unread, markRead, markAllRead } = useNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleClick = (n: Notification) => {
    if (!n.read_at) markRead(n.id);
    if (n.link) { navigate(n.link); setOpen(false); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notificações">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notificações</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllRead}>
              <CheckCheck className="h-3 w-3 mr-1" /> Marcar todas
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-96">
          {items.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Nenhuma notificação
            </div>
          ) : items.map(n => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={cn(
                'flex w-full items-start gap-2 border-b px-3 py-2.5 text-left hover:bg-muted/50 transition-colors',
                !n.read_at && 'bg-primary/5'
              )}
            >
              <div className="mt-0.5">{iconFor(n)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{n.title}</p>
                {n.description && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{n.description}</p>
                )}
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                  {new Date(n.created_at).toLocaleString('pt-BR')}
                </p>
              </div>
              {!n.read_at && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
            </button>
          ))}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
