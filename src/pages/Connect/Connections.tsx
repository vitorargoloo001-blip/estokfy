import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertCircle, CheckCircle2, Clock, RefreshCw, Plug2, Building2,
  Trash2, RotateCcw, Wifi, WifiOff, Info, ExternalLink, ShieldCheck,
} from "lucide-react";
import { usePluggyConnection } from "@/hooks/usePluggyConnection";

// ── Helpers ───────────────────────────────────────────────────────────

const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Nunca";

const PLUGGY_STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  updated:            { label: "Sincronizado",    color: "bg-green-100 text-green-800", icon: CheckCircle2 },
  updating:           { label: "Atualizando",     color: "bg-blue-100 text-blue-800",  icon: RefreshCw },
  pending:            { label: "Pendente",         color: "bg-gray-100 text-gray-700",  icon: Clock },
  login_error:        { label: "Erro de login",    color: "bg-red-100 text-red-800",    icon: AlertCircle },
  waiting_user_input: { label: "Aguardando MFA",   color: "bg-yellow-100 text-yellow-800", icon: Clock },
  outdated:           { label: "Desatualizado",    color: "bg-orange-100 text-orange-800", icon: AlertCircle },
  error:              { label: "Erro",             color: "bg-red-100 text-red-800",    icon: AlertCircle },
  disconnected:       { label: "Desconectado",     color: "bg-gray-100 text-gray-700",  icon: WifiOff },
  connected:          { label: "Conectado",        color: "bg-green-100 text-green-800", icon: CheckCircle2 },
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: "Conta Corrente",
  savings:  "Poupança",
  other:    "Outro",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = PLUGGY_STATUS_CONFIG[status] ?? PLUGGY_STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── Componente ────────────────────────────────────────────────────────

export default function ConnectBankConnections() {
  const {
    connections, loading, syncing, connecting, error,
    loadConnections, openWidget, syncNow, reconnect, disconnect, removeManualConnection,
  } = usePluggyConnection();

  const [confirmDisconnect, setConfirmDisconnect] = useState<{
    id: string;
    name: string;
    pluggyItemDbId: string | null;
  } | null>(null);

  const handleDisconnect = async () => {
    if (!confirmDisconnect) return;
    if (confirmDisconnect.pluggyItemDbId) {
      await disconnect(confirmDisconnect.pluggyItemDbId);
    } else {
      await removeManualConnection(confirmDisconnect.id);
    }
    setConfirmDisconnect(null);
  };

  // Agrupar por pluggy_item (um item pode ter múltiplas contas)
  const grouped = connections.reduce<Record<string, typeof connections>>((acc, c) => {
    const key = c.pluggy_external_item_id ?? c.id;
    acc[key] = acc[key] ?? [];
    acc[key].push(c);
    return acc;
  }, {});

  const groups = Object.values(grouped);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Bancos Conectados</h2>
          <p className="text-muted-foreground mt-1">
            Conecte sua conta bancária via Pluggy para importar transações automaticamente.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => loadConnections()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button onClick={openWidget} disabled={connecting}>
            {connecting
              ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Conectando...</>
              : <><Plug2 className="h-4 w-4 mr-2" />Conectar banco</>}
          </Button>
        </div>
      </div>

      {/* Banner de segurança */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-3 pb-3">
          <div className="flex items-start gap-3 text-sm text-blue-900">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-blue-600" />
            <div>
              <span className="font-medium">Conexão segura via Pluggy.</span>{" "}
              Suas credenciais bancárias nunca são armazenadas pelo Estokfy.
              A integração usa leitura somente — sem acesso a transferências ou pagamentos.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Erro */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-3">
            <p className="text-sm text-red-700">{error}</p>
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
      {!loading && groups.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="pt-12 pb-12 text-center space-y-4">
            <Building2 className="h-14 w-14 mx-auto text-muted-foreground opacity-30" />
            <div>
              <h3 className="text-lg font-semibold">Nenhum banco conectado</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                Clique em <strong>Conectar banco</strong> para vincular sua conta e começar a
                importar transações automaticamente.
              </p>
            </div>
            <Button onClick={openWidget} disabled={connecting} className="mx-auto">
              <Plug2 className="h-4 w-4 mr-2" />
              Conectar banco
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Lista de bancos conectados */}
      {!loading && groups.map((group) => {
        const primary  = group[0];
        const itemId   = primary.pluggy_external_item_id;
        const isSyncing = syncing[itemId ?? "__all__"] || syncing["__all__"];
        const pluggyStatus = primary.pluggy_status ?? primary.status;
        const isError = pluggyStatus === "login_error" || pluggyStatus === "error" || pluggyStatus === "outdated";

        return (
          <Card key={primary.pluggy_item_id ?? primary.id} className={isError ? "border-red-200" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-base">
                      {primary.institution_name ?? primary.bank_name}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {group.length} conta(s) conectada(s)
                    </p>
                  </div>
                  <StatusBadge status={pluggyStatus} />
                </div>

                {/* Ações do item */}
                <div className="flex gap-2 flex-wrap">
                  {isError ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-yellow-300 text-yellow-700 hover:bg-yellow-50"
                      onClick={() => itemId && reconnect(itemId)}
                      disabled={connecting}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      Reconectar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => syncNow(itemId ?? undefined)}
                      disabled={isSyncing}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isSyncing ? "animate-spin" : ""}`} />
                      {isSyncing ? "Sincronizando..." : "Sincronizar agora"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDisconnect({
                      id:            primary.id,
                      name:          primary.institution_name ?? primary.bank_name,
                      pluggyItemDbId: primary.pluggy_item_id ?? null,
                    })}
                  >
                    <WifiOff className="h-3.5 w-3.5 mr-1" />
                    Desconectar
                  </Button>
                </div>
              </div>

              {/* Info de sincronização */}
              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                <span>
                  Última sincronização:{" "}
                  <span className="font-medium">{fmtDateTime(primary.last_synced_at ?? primary.last_sync_at)}</span>
                </span>
                {primary.total_transactions > 0 && (
                  <span>
                    {primary.total_transactions} transação(ões) total
                  </span>
                )}
              </div>
            </CardHeader>

            {/* Contas do item */}
            <CardContent className="pt-0">
              <div className="space-y-2">
                {group.map((conn) => (
                  <div
                    key={conn.id}
                    className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30 border text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-medium text-sm">
                          {ACCOUNT_TYPE_LABELS[conn.account_type] ?? conn.account_type}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {conn.agency ? `Ag. ${conn.agency} · ` : ""}
                          Cc. {conn.account_number}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {conn.last_sync_status === "failed" && (
                        <Badge variant="destructive" className="text-xs">Falhou</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {fmtDateTime(conn.last_sync_at)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirmDisconnect({
                          id:            conn.id,
                          name:          `conta ${conn.account_number}`,
                          pluggyItemDbId: null, // remove só esta conta
                        })}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Legenda / instrução de webhook */}
      {!loading && (
        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <Wifi className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-600" />
                <div>
                  <p className="font-medium text-foreground">Sincronização automática</p>
                  <p>Pluggy notifica o Estokfy via webhook quando novas transações estão disponíveis.</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-600" />
                <div>
                  <p className="font-medium text-foreground">Webhook URL</p>
                  <p className="font-mono break-all">
                    {import.meta.env.VITE_SUPABASE_URL}/functions/v1/pluggy-webhook
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <ExternalLink className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-foreground">Configurar Pluggy</p>
                  <p>
                    Adicione o webhook no{" "}
                    <a
                      href="https://dashboard.pluggy.ai"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      Pluggy Dashboard
                    </a>
                    {" "}e defina{" "}
                    <code className="text-xs">PLUGGY_CLIENT_ID</code>,{" "}
                    <code className="text-xs">PLUGGY_CLIENT_SECRET</code> e{" "}
                    <code className="text-xs">PLUGGY_WEBHOOK_SECRET</code> nas env vars da Edge Function.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog: confirmar desconexão */}
      <Dialog open={!!confirmDisconnect} onOpenChange={() => setConfirmDisconnect(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WifiOff className="h-4 w-4 text-red-500" />
              Desconectar banco
            </DialogTitle>
            <DialogDescription>
              Deseja desconectar <strong>{confirmDisconnect?.name}</strong>?
              As transações já importadas serão mantidas. A sincronização automática será interrompida.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDisconnect(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDisconnect}>
              Desconectar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
