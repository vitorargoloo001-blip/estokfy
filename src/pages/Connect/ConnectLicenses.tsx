import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertCircle, Check, Lock, Pause, Trash2, Zap, RefreshCw, History, Plus, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMasterUser } from "@/hooks/useMasterUser";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface StoreRow {
  store_id: string;
  store_name: string;
  owner_name: string | null;
  owner_email: string | null;
  store_plan: string | null;
  connect_status: string; // none | active | suspended | cancelled
  connect_active: boolean;
  plan_type: string | null;
  amount_paid: number | null;
  contracted_at: string | null;
  expires_at: string | null;
  notes: string | null;
}

interface PanelStats {
  total_stores: number;
  active_count: number;
  suspended_count: number;
  cancelled_count: number;
  recurring_revenue: number;
  total_revenue: number;
}

const PLAN_LABELS: Record<string, string> = {
  mensal: "Mensal", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual", vitalicio: "Vitalício",
};
const PLAN_MONTHS: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };

const STATUS: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  none: { label: "Sem licença", cls: "bg-muted text-muted-foreground", icon: <Lock className="h-3 w-3" /> },
  active: { label: "Ativo", cls: "bg-green-100 text-green-800", icon: <Check className="h-3 w-3" /> },
  suspended: { label: "Suspenso", cls: "bg-orange-100 text-orange-800", icon: <Pause className="h-3 w-3" /> },
  cancelled: { label: "Cancelado", cls: "bg-red-100 text-red-800", icon: <Trash2 className="h-3 w-3" /> },
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const addMonths = (iso: string, months: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};
const fmtCurrency = (v: number | null) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

export default function ConnectLicenses() {
  const { isMaster, loading: masterLoading } = useMasterUser();
  const { revalidateModules } = useAuth();
  const [rows, setRows] = useState<StoreRow[]>([]);
  const [stats, setStats] = useState<PanelStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [fPlan, setFPlan] = useState("all");
  const [fDue, setFDue] = useState("all"); // all | expired | expiring30

  const [actionBusy, setActionBusy] = useState<string | null>(null);

  // Activation modal
  const [actOpen, setActOpen] = useState(false);
  const [actStore, setActStore] = useState<StoreRow | null>(null);
  const [actPlan, setActPlan] = useState("mensal");
  const [actAmount, setActAmount] = useState("");
  const [actStart, setActStart] = useState(todayISO());
  const [actEnd, setActEnd] = useState(addMonths(todayISO(), 1));
  const [actNotes, setActNotes] = useState("");

  // Confirm (suspend/cancel) + history
  const [confirmAction, setConfirmAction] = useState<{ kind: "suspend" | "cancel"; store: StoreRow } | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [histStore, setHistStore] = useState<StoreRow | null>(null);
  const [histRows, setHistRows] = useState<{ action: string; details: any; actor: string; created_at: string }[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r1, r2] = await Promise.all([
        supabase.rpc("list_stores_with_connect"),
        supabase.rpc("get_connect_panel_stats"),
      ]);
      if (r1.error) throw r1.error;
      setRows((r1.data as any as StoreRow[]) || []);
      if (!r2.error && r2.data && (r2.data as any[]).length) setStats((r2.data as any[])[0]);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isMaster) load(); }, [isMaster, load]);

  // Auto-recompute expiry when plan/start changes (except vitalício)
  useEffect(() => {
    if (actPlan === "vitalicio") { setActEnd(""); return; }
    setActEnd(addMonths(actStart || todayISO(), PLAN_MONTHS[actPlan] || 1));
  }, [actPlan, actStart]);

  if (masterLoading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }
  if (!isMaster) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-8 text-center space-y-3">
          <Lock className="h-12 w-12 text-red-600 mx-auto" />
          <h3 className="text-lg font-semibold text-red-900">Acesso Restrito</h3>
          <p className="text-sm text-red-700">Apenas o administrador master pode gerenciar as licenças do Connect.</p>
        </CardContent>
      </Card>
    );
  }

  const openActivate = (store: StoreRow, renew = false) => {
    setActStore(store);
    setActPlan(renew && store.plan_type ? store.plan_type : "mensal");
    setActAmount(renew && store.amount_paid != null ? String(store.amount_paid) : "");
    setActStart(todayISO());
    setActNotes(store.notes || "");
    setActOpen(true);
  };

  const confirmActivate = async () => {
    if (!actStore) return;
    setActionBusy(actStore.store_id);
    try {
      const { error: err } = await supabase.rpc("activate_connect_for_store", {
        p_store_id: actStore.store_id,
        p_plan_type: actPlan,
        p_amount: actAmount ? parseFloat(actAmount.replace(",", ".")) : 0,
        p_starts_at: actStart || todayISO(),
        p_expires_at: actPlan === "vitalicio" ? null : (actEnd || null),
        p_notes: actNotes || null,
      });
      if (err) throw err;
      toast.success("Connect ativado para a loja!");
      setActOpen(false);
      await load();
      await revalidateModules?.(); // atualiza contexto/menu/rotas da sessão atual
    } catch (err: any) {
      toast.error(err?.message || "Erro ao ativar Connect");
    } finally {
      setActionBusy(null);
    }
  };

  const runConfirm = async () => {
    if (!confirmAction) return;
    const { kind, store } = confirmAction;
    setActionBusy(store.store_id);
    try {
      const fn = kind === "suspend" ? "suspend_connect_for_store" : "cancel_connect_for_store";
      const { error: err } = await supabase.rpc(fn, { p_store_id: store.store_id, p_reason: confirmReason || null });
      if (err) throw err;
      toast.success(kind === "suspend" ? "Connect suspenso." : "Connect cancelado.");
      setConfirmAction(null);
      setConfirmReason("");
      await load();
      await revalidateModules?.(); // atualiza contexto/menu/rotas da sessão atual
    } catch (err: any) {
      toast.error(err?.message || "Erro ao processar");
    } finally {
      setActionBusy(null);
    }
  };

  const openHistory = async (store: StoreRow) => {
    setHistStore(store);
    setHistLoading(true);
    setHistRows([]);
    try {
      const { data } = await supabase.rpc("connect_license_history", { p_store_id: store.store_id });
      setHistRows((data as any[]) || []);
    } finally {
      setHistLoading(false);
    }
  };

  const filtered = rows.filter((r) => {
    const t = search.trim().toLowerCase();
    const matchSearch = !t || [r.store_name, r.owner_name, r.owner_email].some((x) => (x || "").toLowerCase().includes(t));
    const matchStatus = fStatus === "all" || r.connect_status === fStatus;
    const matchPlan = fPlan === "all" || r.plan_type === fPlan;
    let matchDue = true;
    if (fDue !== "all") {
      if (!r.expires_at) matchDue = false;
      else {
        const days = Math.ceil((new Date(r.expires_at).getTime() - Date.now()) / 86400000);
        matchDue = fDue === "expired" ? days < 0 : days >= 0 && days <= 30;
      }
    }
    return matchSearch && matchStatus && matchPlan && matchDue;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Zap className="h-6 w-6" /> Gestão de Licenças do Connect</h2>
        <p className="text-muted-foreground mt-1">Ative ou desative o Estokfy Connect em qualquer loja</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Total de lojas" value={stats?.total_stores ?? "—"} />
        <Kpi label="Connect ativo" value={stats?.active_count ?? "—"} cls="text-green-600" />
        <Kpi label="Suspensos" value={stats?.suspended_count ?? "—"} cls="text-orange-600" />
        <Kpi label="Cancelados" value={stats?.cancelled_count ?? "—"} cls="text-red-600" />
        <Kpi label="Receita recorrente" value={stats ? fmtCurrency(stats.recurring_revenue) : "—"} cls="text-primary text-base" />
        <Kpi label="Receita total" value={stats ? fmtCurrency(stats.total_revenue) : "—"} cls="text-primary text-base" />
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar loja, dono, e-mail..." className="pl-9" />
          </div>
          <Select value={fStatus} onValueChange={setFStatus}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="none">Sem licença</SelectItem>
              <SelectItem value="active">Ativo</SelectItem>
              <SelectItem value="suspended">Suspenso</SelectItem>
              <SelectItem value="cancelled">Cancelado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={fPlan} onValueChange={setFPlan}>
            <SelectTrigger><SelectValue placeholder="Plano" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os planos</SelectItem>
              {Object.entries(PLAN_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fDue} onValueChange={setFDue}>
            <SelectTrigger><SelectValue placeholder="Vencimento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Qualquer vencimento</SelectItem>
              <SelectItem value="expiring30">Vence em 30 dias</SelectItem>
              <SelectItem value="expired">Vencidas</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Tabela de lojas */}
      <Card>
        <CardHeader><CardTitle className="text-base">Lojas ({filtered.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
          ) : error ? (
            <div className="text-center py-10 space-y-3">
              <p className="text-sm text-destructive break-words">{error}</p>
              <Button variant="outline" onClick={load}>Tentar novamente</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">Nenhuma loja encontrada.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-3 font-semibold">Loja</th>
                    <th className="text-left py-3 px-3 font-semibold">Proprietário</th>
                    <th className="text-left py-3 px-3 font-semibold">E-mail</th>
                    <th className="text-left py-3 px-3 font-semibold">Plano</th>
                    <th className="text-left py-3 px-3 font-semibold">Status</th>
                    <th className="text-left py-3 px-3 font-semibold">Ativação</th>
                    <th className="text-left py-3 px-3 font-semibold">Vencimento</th>
                    <th className="text-right py-3 px-3 font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const st = STATUS[r.connect_status] || STATUS.none;
                    const busy = actionBusy === r.store_id;
                    return (
                      <tr key={r.store_id} className="border-b hover:bg-muted/30">
                        <td className="py-2.5 px-3 font-medium">{r.store_name}</td>
                        <td className="py-2.5 px-3">{r.owner_name || "—"}</td>
                        <td className="py-2.5 px-3 text-xs">{r.owner_email || "—"}</td>
                        <td className="py-2.5 px-3">{r.plan_type ? PLAN_LABELS[r.plan_type] || r.plan_type : "—"}</td>
                        <td className="py-2.5 px-3">
                          <Badge className={`${st.cls} flex items-center gap-1 w-fit`}>{st.icon}{st.label}</Badge>
                        </td>
                        <td className="py-2.5 px-3 text-xs">{fmtDate(r.contracted_at)}</td>
                        <td className="py-2.5 px-3 text-xs">{r.plan_type === "vitalicio" ? "Vitalício" : fmtDate(r.expires_at)}</td>
                        <td className="py-2.5 px-3">
                          <div className="flex justify-end gap-1.5 flex-wrap">
                            {(r.connect_status === "none" || r.connect_status === "cancelled") && (
                              <Button size="sm" onClick={() => openActivate(r)} disabled={busy}>
                                <Plus className="h-3 w-3 mr-1" /> Ativar
                              </Button>
                            )}
                            {r.connect_status === "active" && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => openActivate(r, true)} disabled={busy}>
                                  <RefreshCw className="h-3 w-3 mr-1" /> Renovar
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => { setConfirmAction({ kind: "suspend", store: r }); setConfirmReason(""); }} disabled={busy}>
                                  <Pause className="h-3 w-3 mr-1" /> Suspender
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => { setConfirmAction({ kind: "cancel", store: r }); setConfirmReason(""); }} disabled={busy}>
                                  <Trash2 className="h-3 w-3 mr-1" /> Cancelar
                                </Button>
                              </>
                            )}
                            {r.connect_status === "suspended" && (
                              <>
                                <Button size="sm" onClick={() => openActivate(r, true)} disabled={busy}>
                                  <Check className="h-3 w-3 mr-1" /> Reativar
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => { setConfirmAction({ kind: "cancel", store: r }); setConfirmReason(""); }} disabled={busy}>
                                  <Trash2 className="h-3 w-3 mr-1" /> Cancelar
                                </Button>
                              </>
                            )}
                            {r.connect_status !== "none" && (
                              <Button size="sm" variant="ghost" onClick={() => openHistory(r)} disabled={busy}>
                                <History className="h-3 w-3 mr-1" /> Histórico
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal Ativar/Renovar */}
      <Dialog open={actOpen} onOpenChange={setActOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ativar Connect — {actStore?.store_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Plano</Label>
              <Select value={actPlan} onValueChange={setActPlan}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(PLAN_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Valor (R$)</Label>
                <Input type="number" min="0" step="0.01" value={actAmount} onChange={(e) => setActAmount(e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <Label className="text-sm">Data de início</Label>
                <Input type="date" value={actStart} onChange={(e) => setActStart(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-sm">Data de vencimento</Label>
              <Input type="date" value={actEnd} onChange={(e) => setActEnd(e.target.value)} disabled={actPlan === "vitalicio"} />
              {actPlan === "vitalicio" && <p className="text-[11px] text-muted-foreground mt-1">Plano vitalício não expira.</p>}
            </div>
            <div>
              <Label className="text-sm">Observações</Label>
              <Textarea value={actNotes} onChange={(e) => setActNotes(e.target.value)} placeholder="Opcional..." className="min-h-20" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActOpen(false)}>Cancelar</Button>
            <Button onClick={confirmActivate} disabled={actionBusy === actStore?.store_id}>
              {actionBusy === actStore?.store_id ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Ativando...</> : "Confirmar Ativação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar suspender/cancelar */}
      <Dialog open={!!confirmAction} onOpenChange={(o) => { if (!o) setConfirmAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmAction?.kind === "suspend" ? "Suspender Connect" : "Cancelar Connect"} — {confirmAction?.store.store_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2 rounded-lg border bg-amber-50 border-amber-200 p-3 text-sm text-amber-900">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <p>A loja perderá acesso ao Connect (menus e telas serão ocultados). Os dados são mantidos. {confirmAction?.kind === "cancel" ? "O cancelamento encerra a licença." : "A suspensão pode ser revertida reativando."}</p>
            </div>
            <div>
              <Label className="text-sm">Motivo (opcional)</Label>
              <Textarea value={confirmReason} onChange={(e) => setConfirmReason(e.target.value)} placeholder="Descreva o motivo..." className="min-h-20" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Voltar</Button>
            <Button variant={confirmAction?.kind === "cancel" ? "destructive" : "default"} onClick={runConfirm} disabled={actionBusy === confirmAction?.store.store_id}>
              {actionBusy === confirmAction?.store.store_id ? "Processando..." : confirmAction?.kind === "suspend" ? "Suspender" : "Cancelar Connect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Histórico */}
      <Dialog open={!!histStore} onOpenChange={(o) => { if (!o) setHistStore(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Histórico — {histStore?.store_name}</DialogTitle></DialogHeader>
          {histLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : histRows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sem histórico.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {histRows.map((h, i) => (
                <div key={i} className="border-l-2 border-muted pl-3 py-1.5 text-sm">
                  <div className="font-medium">{ACTION_LABELS[h.action] || h.action}</div>
                  <div className="text-xs text-muted-foreground">{h.actor} • {new Date(h.created_at).toLocaleString("pt-BR")}</div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  connect_license_activate: "Connect ativado",
  connect_license_suspend: "Connect suspenso",
  connect_license_cancel: "Connect cancelado",
};

function Kpi({ label, value, cls }: { label: string; value: any; cls?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 text-center">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={`text-2xl font-bold ${cls || ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
