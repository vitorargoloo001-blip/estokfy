import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, AlertCircle, XCircle, RefreshCw, Plug2,
  RotateCcw, WifiOff, Webhook, Clock, Activity, Database,
  ChevronDown, ChevronRight, Shield,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePluggyConnection } from "@/hooks/usePluggyConnection";

// ── Tipos ─────────────────────────────────────────────────────────────

interface ConnectionHealth {
  bank_connection_id:   string;
  bank_name:            string;
  institution_name:     string | null;
  account_number:       string;
  account_type:         string;
  connection_status:    string;
  pluggy_status:        string | null;
  last_synced_at:       string | null;
  last_webhook_at:      string | null;
  last_webhook_event:   string | null;
  total_transactions:   number;
  pending_matches:      number;
  divergent_count:      number;
  error_code:           string | null;
  error_message:        string | null;
  has_token_error:      boolean;
  has_sync_error:       boolean;
  has_webhook_stale:    boolean;
  days_since_sync:      number | null;
  days_since_webhook:   number | null;
}

interface SystemLog {
  id:               string;
  log_type:         string;
  message:          string;
  details:          Record<string, unknown>;
  severity:         string;
  bank_name:        string | null;
  institution_name: string | null;
  created_at:       string;
}

// ── Helpers ───────────────────────────────────────────────────────────

const fmtDT = (d: string | null) =>
  d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: "Conta Corrente", savings: "Poupança", other: "Outro",
};

const LOG_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  sync:          { label: "Sync",    color: "bg-blue-100 text-blue-800" },
  webhook:       { label: "Webhook", color: "bg-purple-100 text-purple-800" },
  error:         { label: "Erro",    color: "bg-red-100 text-red-800" },
  reconnect:     { label: "Reconexão", color: "bg-yellow-100 text-yellow-800" },
  token_expired: { label: "Token",   color: "bg-orange-100 text-orange-800" },
  match:         { label: "Match",   color: "bg-green-100 text-green-800" },
  info:          { label: "Info",    color: "bg-gray-100 text-gray-700" },
};

const SEV_ICON: Record<string, typeof CheckCircle2> = {
  info:    CheckCircle2,
  warning: AlertCircle,
  error:   XCircle,
};

// ── Componente de saúde de uma conexão ────────────────────────────────

function HealthCard({ h, onSync, onReconnect, onDisconnect, syncing, connecting }: {
  h: ConnectionHealth;
  onSync: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  syncing: boolean;
  connecting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const hasAlert = h.has_token_error || h.has_sync_error || h.has_webhook_stale;
  const isHealthy = !hasAlert && h.connection_status !== "error";

  return (
    <Card className={hasAlert ? "border-red-200" : "border-green-200"}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isHealthy ? "bg-green-500" : "bg-red-500"} animate-pulse`} />
            <div>
              <CardTitle className="text-sm font-semibold">
                {h.institution_name ?? h.bank_name}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {ACCOUNT_TYPE_LABELS[h.account_type] ?? h.account_type} · {h.account_number}
              </p>
            </div>
            {h.pluggy_status && (
              <Badge variant="outline" className={`text-xs ${
                h.pluggy_status === "updated" ? "border-green-300 text-green-700 bg-green-50" :
                h.pluggy_status === "login_error" ? "border-red-300 text-red-700 bg-red-50" :
                "border-gray-300 text-gray-600"
              }`}>
                {h.pluggy_status}
              </Badge>
            )}
          </div>

          <div className="flex gap-1.5 flex-wrap">
            {h.has_token_error || h.has_sync_error ? (
              <Button size="sm" variant="outline"
                className="border-yellow-300 text-yellow-700 hover:bg-yellow-50 h-7 text-xs"
                onClick={onReconnect} disabled={connecting}>
                <RotateCcw className="h-3 w-3 mr-1" />Reconectar
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={onSync} disabled={syncing}>
                <RefreshCw className={`h-3 w-3 mr-1 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Sincronizando..." : "Sincronizar"}
              </Button>
            )}
            <Button size="sm" variant="ghost"
              className="h-7 text-xs text-muted-foreground hover:text-destructive"
              onClick={onDisconnect}>
              <WifiOff className="h-3 w-3 mr-1" />Desconectar
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
              onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {/* KPIs rápidos */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-2 bg-muted/30 rounded-md text-center">
            <p className="text-xs text-muted-foreground">Transações</p>
            <p className="font-semibold text-sm">{h.total_transactions}</p>
          </div>
          <div className={`p-2 rounded-md text-center ${h.pending_matches > 0 ? "bg-yellow-50" : "bg-muted/30"}`}>
            <p className="text-xs text-muted-foreground">Pendentes</p>
            <p className={`font-semibold text-sm ${h.pending_matches > 0 ? "text-yellow-700" : ""}`}>
              {h.pending_matches}
            </p>
          </div>
          <div className={`p-2 rounded-md text-center ${h.divergent_count > 0 ? "bg-red-50" : "bg-muted/30"}`}>
            <p className="text-xs text-muted-foreground">Divergências</p>
            <p className={`font-semibold text-sm ${h.divergent_count > 0 ? "text-red-700" : ""}`}>
              {h.divergent_count}
            </p>
          </div>
          <div className="p-2 bg-muted/30 rounded-md text-center">
            <p className="text-xs text-muted-foreground">Último sync</p>
            <p className="font-semibold text-sm">
              {h.days_since_sync != null ? `${h.days_since_sync}d` : "—"}
            </p>
          </div>
        </div>

        {/* Alertas */}
        {h.has_token_error && (
          <div className="flex items-start gap-2 p-2.5 bg-red-50 border border-red-200 rounded-md">
            <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-medium text-red-800">Token expirado / erro de login</p>
              <p className="text-red-700 mt-0.5">{h.error_message ?? "Reconecte o banco para restaurar o acesso."}</p>
            </div>
          </div>
        )}
        {h.has_sync_error && !h.has_token_error && (
          <div className="flex items-start gap-2 p-2.5 bg-orange-50 border border-orange-200 rounded-md">
            <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-medium text-orange-800">Erro na última sincronização</p>
              <p className="text-orange-700 mt-0.5">Tente sincronizar novamente ou reconecte o banco.</p>
            </div>
          </div>
        )}
        {h.has_webhook_stale && !h.has_token_error && (
          <div className="flex items-start gap-2 p-2.5 bg-yellow-50 border border-yellow-200 rounded-md">
            <Webhook className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-medium text-yellow-800">Webhook não recebido há mais de 48h</p>
              <p className="text-yellow-700 mt-0.5">
                Verifique a configuração do webhook no Pluggy Dashboard.
              </p>
            </div>
          </div>
        )}
        {isHealthy && (
          <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-md">
            <Shield className="h-4 w-4 text-green-600" />
            <p className="text-xs text-green-800 font-medium">Conexão saudável</p>
          </div>
        )}

        {/* Detalhe expandido */}
        {expanded && (
          <div className="text-xs text-muted-foreground space-y-1 pt-1 border-t">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span><strong>Última sync:</strong> {fmtDT(h.last_synced_at)}</span>
              <span><strong>Último webhook:</strong> {fmtDT(h.last_webhook_at)}</span>
              <span><strong>Evento webhook:</strong> {h.last_webhook_event ?? "—"}</span>
              <span><strong>Status conexão:</strong> {h.connection_status}</span>
              {h.error_code && <span><strong>Código erro:</strong> {h.error_code}</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Componente principal ──────────────────────────────────────────────

export default function ConnectionHealthPage() {
  const { profile } = useAuth();
  const { syncing, connecting, syncNow, reconnect, disconnect } = usePluggyConnection();

  const [health, setHealth]   = useState<ConnectionHealth[]>([]);
  const [logs, setLogs]       = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logLoading, setLogLoading] = useState(true);
  const [logFilter, setLogFilter] = useState<string>("all");

  const load = useCallback(async () => {
    if (!profile?.store_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_connection_health", {
        p_store_id: profile.store_id,
      });
      if (error) throw error;
      setHealth((data as ConnectionHealth[]) ?? []);
    } catch (e) {
      toast.error("Erro ao carregar saúde: " + String(e));
    } finally {
      setLoading(false);
    }
  }, [profile?.store_id]);

  const loadLogs = useCallback(async () => {
    if (!profile?.store_id) return;
    setLogLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_connect_logs", {
        p_store_id: profile.store_id,
        p_log_type: logFilter === "all" ? null : logFilter,
        p_limit:    50,
        p_offset:   0,
      });
      if (error) throw error;
      setLogs((data as SystemLog[]) ?? []);
    } catch (e) {
      console.error("Logs error:", e);
    } finally {
      setLogLoading(false);
    }
  }, [profile?.store_id, logFilter]);

  useEffect(() => { load(); loadLogs(); }, [load, loadLogs]);

  const alertCount = health.filter(h => h.has_token_error || h.has_sync_error || h.has_webhook_stale).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6" />
            Saúde da Conexão
          </h2>
          <p className="text-muted-foreground mt-1">
            Monitore o status em tempo real de cada banco conectado.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { load(); loadLogs(); }} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Banner de alertas */}
      {alertCount > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-2 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
              <strong>{alertCount} banco(s) precisam de atenção.</strong>
              <span className="text-red-700">Verifique os alertas abaixo.</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-10">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {/* Estado vazio */}
      {!loading && health.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="pt-12 pb-12 text-center">
            <Plug2 className="h-12 w-12 mx-auto text-muted-foreground opacity-30 mb-3" />
            <p className="font-semibold">Nenhum banco conectado</p>
            <p className="text-sm text-muted-foreground mt-1">
              Conecte um banco em <strong>Bancos Conectados</strong> para monitorar a saúde aqui.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Cards de saúde */}
      {!loading && health.map((h) => (
        <HealthCard
          key={h.bank_connection_id}
          h={h}
          syncing={!!syncing[h.bank_connection_id]}
          connecting={connecting}
          onSync={() => syncNow()}
          onReconnect={() => {
            const pluggyExtId = h.pluggy_status ? h.bank_connection_id : undefined;
            if (pluggyExtId) reconnect(pluggyExtId);
          }}
          onDisconnect={() => disconnect(h.bank_connection_id)}
        />
      ))}

      {/* Log de sistema */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4" />
              Log do Sistema
            </CardTitle>
            <div className="flex gap-1 flex-wrap">
              {["all", "sync", "webhook", "error", "match"].map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={logFilter === f ? "default" : "outline"}
                  className="h-6 text-xs px-2"
                  onClick={() => setLogFilter(f)}
                >
                  {f === "all" ? "Todos" : LOG_TYPE_CONFIG[f]?.label ?? f}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {logLoading ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : logs.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              Nenhum log registrado ainda.
            </p>
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {logs.map((log) => {
                const cfg = LOG_TYPE_CONFIG[log.log_type] ?? LOG_TYPE_CONFIG.info;
                const SevIcon = SEV_ICON[log.severity] ?? CheckCircle2;
                return (
                  <div key={log.id} className="flex items-start gap-3 py-2 border-b last:border-0 text-xs">
                    <SevIcon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${
                      log.severity === "error" ? "text-red-500" :
                      log.severity === "warning" ? "text-yellow-500" : "text-green-500"
                    }`} />
                    <span className={`${cfg.color} px-1.5 py-0.5 rounded text-xs font-medium shrink-0`}>
                      {cfg.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{log.message}</p>
                      {log.bank_name && (
                        <p className="text-muted-foreground">{log.institution_name ?? log.bank_name}</p>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {fmtDT(log.created_at)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
