import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, Play, Pause, Trash2, Edit, RefreshCw, CheckCircle, XCircle,
  Clock, AlertTriangle, Bell, ChevronDown, ChevronUp, Users,
  TrendingUp, FileText, BarChart2, CreditCard, Plus, Loader2,
  CheckCheck, ArrowRight,
} from "lucide-react";

// ── Tipos ──────────────────────────────────────────────────────────────

interface Automation {
  id: string;
  type: AutomationType;
  name: string;
  description: string | null;
  is_active: boolean;
  config: Record<string, unknown>;
  schedule_config: ScheduleConfig;
  channels: string[];
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_status: string | null;
  runs_today: number;
  runs_total: number;
  errors_total: number;
}

interface AutomationRun {
  run_id: string;
  automation_id: string;
  automation_name: string;
  automation_type: string;
  result: Record<string, unknown>;
  started_at: string;
  triggered_by: string | null;
}

interface Run {
  id: string;
  status: string;
  trigger_type: string;
  result: Record<string, unknown> | null;
  error_message: string | null;
  duration_ms: number | null;
  items_affected: number;
  requires_approval: boolean;
  approved_at: string | null;
  started_at: string;
  completed_at: string | null;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  severity: string;
  status: string;
  created_at: string;
}

interface Dashboard {
  total_active: number;
  runs_today: number;
  errors_today: number;
  pending_approval: number;
  unread_notifications: number;
  next_run_at: string | null;
}

type AutomationType =
  | "auto_reconciliation"
  | "divergence_alert"
  | "bank_disconnected"
  | "daily_report"
  | "weekly_report"
  | "overdue_collection"
  | "cashflow_risk";

interface ScheduleConfig {
  frequency: "manual" | "hourly" | "daily" | "weekly" | "monthly";
  hour?: number;
  minute?: number;
  day_of_week?: number;
  day_of_month?: number;
}

// ── Configurações de tipo ──────────────────────────────────────────────

const AUTOMATION_META: Record<AutomationType, {
  label: string; icon: React.FC<{ className?: string }>; color: string;
  description: string; requiresApproval: boolean;
  defaultConfig: Record<string, unknown>;
}> = {
  auto_reconciliation: {
    label: "Conciliação Automática",
    icon: Zap,
    color: "text-emerald-600",
    description: "Concilia automaticamente transações com score alto",
    requiresApproval: false,
    defaultConfig: { min_confidence: 85 },
  },
  divergence_alert: {
    label: "Alerta de Divergência",
    icon: AlertTriangle,
    color: "text-amber-600",
    description: "Notifica quando há divergências bancárias pendentes",
    requiresApproval: false,
    defaultConfig: { min_divergences: 1 },
  },
  bank_disconnected: {
    label: "Banco Desconectado",
    icon: XCircle,
    color: "text-red-600",
    description: "Alerta crítico quando conexão bancária falha",
    requiresApproval: false,
    defaultConfig: { max_hours_offline: 24 },
  },
  daily_report: {
    label: "Relatório Diário",
    icon: BarChart2,
    color: "text-blue-600",
    description: "Resumo financeiro diário do Connect",
    requiresApproval: false,
    defaultConfig: { send_hour: 8 },
  },
  weekly_report: {
    label: "Relatório Semanal",
    icon: FileText,
    color: "text-indigo-600",
    description: "Consolidado semanal com comparativo",
    requiresApproval: false,
    defaultConfig: { send_day: 1, send_hour: 8 },
  },
  overdue_collection: {
    label: "Cobrança de Vencidos",
    icon: Users,
    color: "text-orange-600",
    description: "Lista clientes com pendência (requer aprovação humana)",
    requiresApproval: true,
    defaultConfig: { min_days_overdue: 1, min_amount: 0 },
  },
  cashflow_risk: {
    label: "Risco de Fluxo de Caixa",
    icon: TrendingUp,
    color: "text-purple-600",
    description: "Alerta quando fluxo previsto está em risco",
    requiresApproval: false,
    defaultConfig: { at_risk_threshold_pct: 30 },
  },
};

const FREQ_LABELS: Record<string, string> = {
  manual: "Manual",
  hourly: "A cada hora",
  daily: "Diário",
  weekly: "Semanal",
  monthly: "Mensal",
};

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(s: string | null) {
  if (!s) return null;
  const map: Record<string, { label: string; variant: "default" | "destructive" | "outline" | "secondary" }> = {
    success: { label: "Sucesso", variant: "default" },
    error: { label: "Erro", variant: "destructive" },
    pending_approval: { label: "Aguard. Aprovação", variant: "secondary" },
    running: { label: "Executando", variant: "outline" },
    skipped: { label: "Pulado", variant: "outline" },
  };
  const m = map[s] ?? { label: s, variant: "outline" as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

// ── Componente principal ───────────────────────────────────────────────

export default function ConnectAutomations() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const storeId = profile?.store_id;
  const canEdit = ["owner", "admin", "manager", "finance"].includes(profile?.role ?? "");

  const [automations, setAutomations] = useState<Automation[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<AutomationRun[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Automation | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<Record<string, Run[]>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [triggerLoading, setTriggerLoading] = useState(false);

  // Form state
  const [form, setForm] = useState<{
    type: AutomationType;
    name: string;
    description: string;
    config: string;
    schedule: ScheduleConfig;
    channels: string[];
    is_active: boolean;
  }>({
    type: "divergence_alert",
    name: "",
    description: "",
    config: "{}",
    schedule: { frequency: "daily", hour: 8, minute: 0 },
    channels: ["internal"],
    is_active: true,
  });

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const [autoRes, dashRes, pendRes, notifRes] = await Promise.all([
        supabase.rpc("get_connect_automations", { p_store_id: storeId }),
        supabase.rpc("get_automations_dashboard", { p_store_id: storeId }),
        supabase.rpc("get_pending_approvals", { p_store_id: storeId }),
        supabase.rpc("get_connect_notifications", { p_store_id: storeId, p_unread_only: false, p_limit: 30 }),
      ]);
      setAutomations((autoRes.data as Automation[]) ?? []);
      setDashboard(dashRes.data as Dashboard);
      setPendingApprovals((pendRes.data as AutomationRun[]) ?? []);
      setNotifications((notifRes.data as Notification[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  // ── Ações ────────────────────────────────────────────────────────────

  async function handleToggle(auto: Automation) {
    if (!canEdit) return;
    const { data, error } = await supabase.rpc("toggle_connect_automation", {
      p_id: auto.id,
      p_store_id: storeId,
    });
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: (data as any).is_active ? "Automação ativada" : "Automação desativada" });
    load();
  }

  async function handleDelete(auto: Automation) {
    if (!canEdit || !window.confirm(`Excluir "${auto.name}"?`)) return;
    const { error } = await supabase.rpc("delete_connect_automation", {
      p_id: auto.id, p_store_id: storeId,
    });
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Automação excluída" });
    load();
  }

  async function handleRun(auto: Automation) {
    if (!storeId) return;
    setRunningId(auto.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-connect-automations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ automation_id: auto.id, store_id: storeId, trigger_type: "manual" }),
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Erro desconhecido");
      if (result.skipped) {
        toast({ title: "Execução ignorada", description: "Já executada no período de idempotência." });
      } else {
        toast({ title: `Automação executada`, description: `Status: ${result.status} | ${result.items_affected} item(s)` });
      }
    } catch (err) {
      toast({ title: "Erro ao executar", description: (err as Error).message, variant: "destructive" });
    } finally {
      setRunningId(null);
      load();
    }
  }

  async function handleApprove(runId: string) {
    if (!canEdit || !storeId) return;
    setApprovingId(runId);
    const { error } = await supabase.rpc("approve_automation_run", {
      p_run_id: runId, p_store_id: storeId,
    });
    setApprovingId(null);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Aprovado com sucesso" });
    load();
  }

  async function handleMarkRead(id: string) {
    await supabase.rpc("mark_notification_read", { p_id: id, p_store_id: storeId });
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, status: "read" } : n));
  }

  async function handleTriggerAI() {
    if (!storeId) return;
    setTriggerLoading(true);
    const { data, error } = await supabase.rpc("trigger_ai_automations", { p_store_id: storeId });
    setTriggerLoading(false);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    const d = data as any;
    toast({ title: `IA disparou automações`, description: `${d.notifications_created} notificação(ões) criada(s)` });
    load();
  }

  async function loadRunHistory(autoId: string) {
    if (runHistory[autoId]) { setExpandedRun(expandedRun === autoId ? null : autoId); return; }
    const { data } = await supabase.rpc("get_automation_runs", {
      p_automation_id: autoId, p_store_id: storeId, p_limit: 10,
    });
    setRunHistory((prev) => ({ ...prev, [autoId]: (data as Run[]) ?? [] }));
    setExpandedRun(autoId);
  }

  // ── Dialog salvar ─────────────────────────────────────────────────────

  function openCreate() {
    const meta = AUTOMATION_META["divergence_alert"];
    setEditTarget(null);
    setForm({
      type: "divergence_alert",
      name: meta.label,
      description: meta.description,
      config: JSON.stringify(meta.defaultConfig, null, 2),
      schedule: { frequency: "daily", hour: 8, minute: 0 },
      channels: ["internal"],
      is_active: true,
    });
    setDialogOpen(true);
  }

  function openEdit(auto: Automation) {
    setEditTarget(auto);
    setForm({
      type: auto.type,
      name: auto.name,
      description: auto.description ?? "",
      config: JSON.stringify(auto.config, null, 2),
      schedule: auto.schedule_config,
      channels: auto.channels,
      is_active: auto.is_active,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!storeId) return;
    let parsedConfig: Record<string, unknown> = {};
    try { parsedConfig = JSON.parse(form.config || "{}"); }
    catch { toast({ title: "Config JSON inválido", variant: "destructive" }); return; }

    if (editTarget) {
      const { error } = await supabase.rpc("update_connect_automation", {
        p_id: editTarget.id,
        p_store_id: storeId,
        p_name: form.name,
        p_description: form.description || null,
        p_config: parsedConfig,
        p_schedule: form.schedule,
        p_channels: form.channels,
        p_is_active: form.is_active,
      });
      if (error) { toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Automação atualizada" });
    } else {
      const meta = AUTOMATION_META[form.type];
      const { error } = await supabase.rpc("create_connect_automation", {
        p_store_id: storeId,
        p_type: form.type,
        p_name: form.name || meta.label,
        p_description: form.description || meta.description,
        p_config: parsedConfig,
        p_schedule: form.schedule,
        p_channels: form.channels,
        p_is_active: form.is_active,
      });
      if (error) { toast({ title: "Erro ao criar", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Automação criada" });
    }

    setDialogOpen(false);
    load();
  }

  function onTypeChange(t: AutomationType) {
    const meta = AUTOMATION_META[t];
    setForm((f) => ({
      ...f,
      type: t,
      name: f.name || meta.label,
      description: f.description || meta.description,
      config: JSON.stringify(meta.defaultConfig, null, 2),
    }));
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => n.status !== "read" && n.status !== "dismissed").length;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-amber-500" />
            Central de Automações
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Automatize ações recorrentes do Connect com segurança e auditoria
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleTriggerAI} disabled={triggerLoading}>
            {triggerLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Disparar IA
          </Button>
          {canEdit && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Nova Automação
            </Button>
          )}
        </div>
      </div>

      {/* Dashboard KPIs */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Ativas", value: dashboard.total_active, icon: Zap, color: "text-emerald-600" },
            { label: "Execuções hoje", value: dashboard.runs_today, icon: Play, color: "text-blue-600" },
            { label: "Erros hoje", value: dashboard.errors_today, icon: XCircle, color: dashboard.errors_today > 0 ? "text-red-600" : "text-muted-foreground" },
            { label: "Aguard. aprovação", value: dashboard.pending_approval, icon: CheckCheck, color: dashboard.pending_approval > 0 ? "text-orange-600" : "text-muted-foreground" },
            { label: "Notificações", value: unreadCount, icon: Bell, color: unreadCount > 0 ? "text-purple-600" : "text-muted-foreground" },
            { label: "Próx. execução", value: dashboard.next_run_at ? fmtDate(dashboard.next_run_at) : "—", icon: Clock, color: "text-slate-600", small: true },
          ].map(({ label, value, icon: Icon, color, small }) => (
            <Card key={label} className="p-3">
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${color}`} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <p className={`font-bold mt-1 ${small ? "text-sm" : "text-xl"}`}>{value}</p>
            </Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="automacoes">
        <TabsList>
          <TabsTrigger value="automacoes">
            Automações
            <Badge variant="secondary" className="ml-2">{automations.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="aprovacoes">
            Aprovações
            {pendingApprovals.length > 0 && (
              <Badge variant="destructive" className="ml-2">{pendingApprovals.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="notificacoes">
            Notificações
            {unreadCount > 0 && (
              <Badge variant="default" className="ml-2">{unreadCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Tab Automações ─────────────────────────────────────────── */}
        <TabsContent value="automacoes" className="mt-4 space-y-3">
          {automations.length === 0 && (
            <Card className="p-8 text-center text-muted-foreground">
              <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>Nenhuma automação configurada.</p>
              {canEdit && (
                <Button className="mt-3" size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-1" /> Criar primeira automação
                </Button>
              )}
            </Card>
          )}

          {automations.map((auto) => {
            const meta = AUTOMATION_META[auto.type];
            const Icon = meta.icon;
            const isRunning = runningId === auto.id;
            const isExpanded = expandedRun === auto.id;

            return (
              <Card key={auto.id} className={auto.is_active ? "" : "opacity-60"}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`mt-1 ${meta.color}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{auto.name}</span>
                          {statusBadge(auto.last_run_status)}
                          {meta.requiresApproval && (
                            <Badge variant="outline" className="text-orange-600 border-orange-300">
                              Requer aprovação
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{auto.description ?? meta.description}</p>
                        <div className="flex gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {FREQ_LABELS[auto.schedule_config?.frequency ?? "manual"]}
                          </span>
                          <span className="flex items-center gap-1">
                            <Bell className="h-3 w-3" />
                            {auto.channels.join(", ")}
                          </span>
                          <span>Hoje: {auto.runs_today} exec.</span>
                          <span>Total: {auto.runs_total} | Erros: {auto.errors_total}</span>
                          {auto.last_run_at && <span>Último: {fmtDate(auto.last_run_at)}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {canEdit && (
                        <Switch
                          checked={auto.is_active}
                          onCheckedChange={() => handleToggle(auto)}
                        />
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRun(auto)}
                        disabled={isRunning}
                        title="Executar agora"
                      >
                        {isRunning
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      {canEdit && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(auto)}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDelete(auto)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => loadRunHistory(auto.id)}
                        title="Ver histórico"
                      >
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>

                  {/* Histórico expandido */}
                  {isExpanded && (
                    <div className="mt-4 border-t pt-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Últimas execuções</p>
                      {(runHistory[auto.id] ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">Nenhuma execução registrada.</p>
                      ) : (
                        (runHistory[auto.id] ?? []).map((run) => (
                          <div
                            key={run.id}
                            className="flex items-center justify-between text-xs bg-muted/40 rounded p-2"
                          >
                            <div className="flex items-center gap-2">
                              {statusBadge(run.status)}
                              <span className="text-muted-foreground">{fmtDate(run.started_at)}</span>
                              <span className="capitalize text-muted-foreground">{run.trigger_type}</span>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground">
                              {run.items_affected > 0 && <span>{run.items_affected} item(s)</span>}
                              {run.duration_ms != null && <span>{run.duration_ms}ms</span>}
                              {run.error_message && (
                                <span className="text-red-500 truncate max-w-[200px]" title={run.error_message}>
                                  {run.error_message.slice(0, 60)}
                                </span>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ── Tab Aprovações ─────────────────────────────────────────── */}
        <TabsContent value="aprovacoes" className="mt-4 space-y-3">
          {pendingApprovals.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              <CheckCircle className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>Nenhuma ação aguardando aprovação.</p>
            </Card>
          ) : (
            pendingApprovals.map((ap) => {
              const meta = AUTOMATION_META[ap.automation_type as AutomationType] ?? AUTOMATION_META.overdue_collection;
              const Icon = meta.icon;
              const customers = (ap.result?.customers as any[]) ?? [];
              const total = ap.result?.total_overdue as number ?? 0;
              const isApproving = approvingId === ap.run_id;

              return (
                <Card key={ap.run_id} className="border-orange-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Icon className={`h-5 w-5 ${meta.color}`} />
                      {ap.automation_name}
                      <Badge variant="outline" className="text-orange-600 border-orange-300 ml-auto">
                        Aguardando aprovação
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Disparado em {fmtDate(ap.started_at)} •{" "}
                      {customers.length} cliente(s) identificado(s) •{" "}
                      Total em atraso: <strong>R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
                    </p>

                    {customers.length > 0 && (
                      <div className="border rounded-md overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 text-left">Cliente</th>
                              <th className="px-3 py-2 text-right">Débito</th>
                              <th className="px-3 py-2 text-right">Parcelas</th>
                            </tr>
                          </thead>
                          <tbody>
                            {customers.slice(0, 8).map((c: any, i: number) => (
                              <tr key={i} className="border-t">
                                <td className="px-3 py-2">{c.name}</td>
                                <td className="px-3 py-2 text-right text-red-600 font-medium">
                                  R$ {c.total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                </td>
                                <td className="px-3 py-2 text-right text-muted-foreground">{c.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {ap.result?.message_template && (
                      <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm">
                        <p className="font-medium text-amber-800 mb-1">Mensagem preparada:</p>
                        <p className="text-amber-700 font-mono text-xs">{ap.result.message_template as string}</p>
                      </div>
                    )}

                    <div className="flex items-center gap-3 pt-1">
                      <Button
                        size="sm"
                        onClick={() => handleApprove(ap.run_id)}
                        disabled={isApproving || !canEdit}
                      >
                        {isApproving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle className="h-4 w-4 mr-1" />}
                        Aprovar (marcar como revisado)
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Nenhuma mensagem é enviada automaticamente. A aprovação apenas registra a revisão.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* ── Tab Notificações ───────────────────────────────────────── */}
        <TabsContent value="notificacoes" className="mt-4 space-y-2">
          {notifications.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>Nenhuma notificação registrada.</p>
            </Card>
          ) : (
            notifications.map((n) => {
              const isUnread = n.status !== "read" && n.status !== "dismissed";
              const sevColors: Record<string, string> = {
                critical: "border-l-red-500",
                warning: "border-l-amber-500",
                info: "border-l-blue-400",
              };
              return (
                <div
                  key={n.id}
                  className={`border-l-4 ${sevColors[n.severity] ?? "border-l-slate-300"} bg-card rounded p-3 flex items-start gap-3 ${isUnread ? "bg-blue-50/40" : "opacity-70"}`}
                >
                  <Bell className={`h-4 w-4 mt-0.5 flex-shrink-0 ${n.severity === "critical" ? "text-red-500" : n.severity === "warning" ? "text-amber-500" : "text-blue-500"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm">{n.title}</p>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{fmtDate(n.created_at)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-line">{n.body}</p>
                  </div>
                  {isUnread && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-shrink-0 text-xs"
                      onClick={() => handleMarkRead(n.id)}
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </TabsContent>
      </Tabs>

      {/* ── Dialog criar/editar ──────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Editar automação" : "Nova automação"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!editTarget && (
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={(v) => onTypeChange(v as AutomationType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(AUTOMATION_META) as AutomationType[]).map((k) => (
                      <SelectItem key={k} value={k}>{AUTOMATION_META[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{AUTOMATION_META[form.type].description}</p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Nome da automação"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Descrição (opcional)</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Descrição breve"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Frequência</Label>
              <Select
                value={form.schedule.frequency}
                onValueChange={(v) => setForm((f) => ({ ...f, schedule: { ...f.schedule, frequency: v as ScheduleConfig["frequency"] } }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FREQ_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(form.schedule.frequency === "daily" || form.schedule.frequency === "weekly") && (
              <div className="space-y-1.5">
                <Label>Horário (hora)</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={form.schedule.hour ?? 8}
                  onChange={(e) => setForm((f) => ({ ...f, schedule: { ...f.schedule, hour: Number(e.target.value) } }))}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Canais de notificação</Label>
              <div className="flex gap-3">
                {(["internal", "email"] as const).map((ch) => (
                  <label key={ch} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.channels.includes(ch)}
                      onChange={(e) => {
                        setForm((f) => ({
                          ...f,
                          channels: e.target.checked
                            ? [...f.channels, ch]
                            : f.channels.filter((c) => c !== ch),
                        }));
                      }}
                    />
                    <span className="text-sm capitalize">{ch === "internal" ? "Interno" : "E-mail"}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Configuração (JSON)</Label>
              <Textarea
                value={form.config}
                onChange={(e) => setForm((f) => ({ ...f, config: e.target.value }))}
                className="font-mono text-xs"
                rows={5}
              />
              <p className="text-xs text-muted-foreground">
                Parâmetros específicos do tipo de automação
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
              <Label>Ativar imediatamente</Label>
            </div>

            {AUTOMATION_META[form.type].requiresApproval && (
              <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm text-orange-800">
                <strong>Requer aprovação humana:</strong> Esta automação prepara ações mas não executa automaticamente. Um responsável deve revisar e aprovar antes de qualquer envio.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>{editTarget ? "Salvar alterações" : "Criar automação"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
