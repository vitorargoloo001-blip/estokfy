import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, AlertCircle, Info, Bell, BellOff, CheckCheck, RefreshCw,
} from "lucide-react";
import { useConnectAlerts, type ConnectAlert } from "@/hooks/useConnectAlerts";
import { toast } from "sonner";

const SEVERITY_CONFIG = {
  error: {
    label: "Erro",
    icon: AlertCircle,
    badgeClass: "bg-red-100 text-red-800 border-red-300",
    cardClass: "border-l-4 border-l-red-500",
    iconClass: "text-red-500",
  },
  warning: {
    label: "Atenção",
    icon: AlertTriangle,
    badgeClass: "bg-yellow-100 text-yellow-800 border-yellow-300",
    cardClass: "border-l-4 border-l-yellow-400",
    iconClass: "text-yellow-500",
  },
  info: {
    label: "Informação",
    icon: Info,
    badgeClass: "bg-blue-100 text-blue-800 border-blue-300",
    cardClass: "border-l-4 border-l-blue-400",
    iconClass: "text-blue-500",
  },
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  divergent_transaction: "Transação divergente",
  low_reconciliation_rate: "Taxa baixa de conciliação",
  bank_connection_error: "Erro de conexão bancária",
  sync_failed: "Falha na sincronização",
  pending_too_long: "Pendente por muito tempo",
  demo: "Demonstração",
};

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function AlertCard({ alert, onDismiss, onRead }: {
  alert: ConnectAlert;
  onDismiss: (id: string) => void;
  onRead: (id: string) => void;
}) {
  const cfg = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;
  const Icon = cfg.icon;

  return (
    <div
      className={`flex gap-3 p-4 rounded-lg border bg-card shadow-sm ${cfg.cardClass} ${
        !alert.is_read ? "bg-muted/30" : ""
      }`}
      onClick={() => !alert.is_read && onRead(alert.id)}
    >
      <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${cfg.iconClass}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-sm">{alert.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{alert.message}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge variant="outline" className={`text-xs border ${cfg.badgeClass}`}>
              {cfg.label}
            </Badge>
            {!alert.is_read && (
              <span className="h-2 w-2 rounded-full bg-primary mt-1" />
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {fmtDateTime(alert.created_at)}
            </span>
            {alert.entity_type && (
              <Badge variant="secondary" className="text-xs">
                {ALERT_TYPE_LABELS[alert.alert_type] ?? alert.alert_type}
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(alert.id);
            }}
          >
            <BellOff className="h-3 w-3 mr-1" />
            Dispensar
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ConnectAlerts() {
  const {
    alerts, unreadCount, loading, error,
    load, dismissAlert, markRead, dismissAll, markAllRead,
  } = useConnectAlerts();

  useEffect(() => {
    markAllRead();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts.length]);

  const handleDismiss = async (id: string) => {
    await dismissAlert(id);
    toast.success("Alerta dispensado");
  };

  const handleDismissAll = async () => {
    const count = await dismissAll();
    toast.success(`${count} alerta(s) dispensado(s)`);
  };

  const grouped = {
    error:   alerts.filter((a) => a.severity === "error"   && !a.dismissed_at),
    warning: alerts.filter((a) => a.severity === "warning" && !a.dismissed_at),
    info:    alerts.filter((a) => a.severity === "info"    && !a.dismissed_at),
  };

  const activeCount = grouped.error.length + grouped.warning.length + grouped.info.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bell className="h-6 w-6" />
            Alertas
          </h2>
          <p className="text-muted-foreground mt-1">
            Notificações sobre divergências, sincronizações e taxa de conciliação
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => load()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {activeCount > 0 && (
            <Button variant="outline" size="sm" onClick={handleDismissAll}>
              <CheckCheck className="h-4 w-4 mr-1" />
              Dispensar todos
            </Button>
          )}
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        <Card className={grouped.error.length > 0 ? "border-red-200" : ""}>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <AlertCircle className={`h-8 w-8 ${grouped.error.length > 0 ? "text-red-500" : "text-muted-foreground"}`} />
            <div>
              <p className={`text-2xl font-bold ${grouped.error.length > 0 ? "text-red-600" : ""}`}>
                {grouped.error.length}
              </p>
              <p className="text-xs text-muted-foreground">Erros</p>
            </div>
          </CardContent>
        </Card>
        <Card className={grouped.warning.length > 0 ? "border-yellow-200" : ""}>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <AlertTriangle className={`h-8 w-8 ${grouped.warning.length > 0 ? "text-yellow-500" : "text-muted-foreground"}`} />
            <div>
              <p className={`text-2xl font-bold ${grouped.warning.length > 0 ? "text-yellow-600" : ""}`}>
                {grouped.warning.length}
              </p>
              <p className="text-xs text-muted-foreground">Avisos</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <Info className="h-8 w-8 text-blue-500" />
            <div>
              <p className="text-2xl font-bold text-blue-600">{grouped.info.length}</p>
              <p className="text-xs text-muted-foreground">Informativos</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4">
            <p className="text-red-700 text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {!loading && activeCount === 0 && (
        <Card className="border-dashed">
          <CardContent className="pt-14 pb-14 text-center">
            <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-30" />
            <h3 className="font-semibold">Nenhum alerta ativo</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Tudo em ordem! Novos alertas aparecerão aqui automaticamente.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && grouped.error.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-red-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Erros ({grouped.error.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {grouped.error.map((a) => (
              <AlertCard
                key={a.id}
                alert={a}
                onDismiss={handleDismiss}
                onRead={markRead}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {!loading && grouped.warning.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-yellow-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Avisos ({grouped.warning.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {grouped.warning.map((a) => (
              <AlertCard
                key={a.id}
                alert={a}
                onDismiss={handleDismiss}
                onRead={markRead}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {!loading && grouped.info.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-blue-700 flex items-center gap-2">
              <Info className="h-4 w-4" />
              Informativos ({grouped.info.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {grouped.info.map((a) => (
              <AlertCard
                key={a.id}
                alert={a}
                onDismiss={handleDismiss}
                onRead={markRead}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
