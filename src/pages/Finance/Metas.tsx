import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Target, TrendingUp, CheckCircle, AlertCircle, Plus, Loader2, Trash2, Edit, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface GoalProgress {
  goal_id: string;
  goal_type: string;
  target_value: number;
  realized: number;
  progress_pct: number;
  notes: string | null;
  on_track: boolean;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const GOAL_META: Record<string, { label: string; unit: "BRL" | "PCT"; icon: string; color: string }> = {
  faturamento:  { label: "Faturamento",   unit: "BRL", icon: "📈", color: "text-emerald-600" },
  lucro:        { label: "Lucro",         unit: "BRL", icon: "💰", color: "text-blue-600"    },
  recebimentos: { label: "Recebimentos",  unit: "BRL", icon: "💳", color: "text-indigo-600"  },
  inadimplencia:{ label: "Inadimplência", unit: "PCT", icon: "⚠️", color: "text-red-600"     },
};

const MONTHS = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

function ProgressBar({ pct, onTrack }: { pct: number; onTrack: boolean }) {
  const color = pct >= 100 ? "bg-emerald-500" : onTrack ? "bg-blue-500" : "bg-amber-500";
  return (
    <div className="h-2.5 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full ${color} rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

export default function Metas() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const storeId = profile?.store_id;
  const canEdit = ["owner", "admin", "manager", "finance"].includes(profile?.role ?? "");

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<GoalProgress | null>(null);
  const [form, setForm] = useState({ goal_type: "faturamento", target_value: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("get_finance_goals_progress", {
      p_store_id: storeId, p_month: month, p_year: year,
    });
    setLoading(false);
    if (error) { toast({ title: "Erro ao carregar metas", variant: "destructive" }); return; }
    setGoals((data as GoalProgress[]) ?? []);
  }, [storeId, month, year]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditGoal(null);
    setForm({ goal_type: "faturamento", target_value: "", notes: "" });
    setDialogOpen(true);
  }

  function openEdit(g: GoalProgress) {
    setEditGoal(g);
    setForm({
      goal_type: g.goal_type,
      target_value: String(g.target_value),
      notes: g.notes ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!storeId || !form.target_value) return;
    setSaving(true);
    const { error } = await supabase.rpc("upsert_finance_goal", {
      p_store_id: storeId,
      p_goal_type: form.goal_type,
      p_month: month,
      p_year: year,
      p_target: Number(form.target_value),
      p_notes: form.notes || null,
    });
    setSaving(false);
    if (error) { toast({ title: "Erro ao salvar meta", description: error.message, variant: "destructive" }); return; }
    toast({ title: editGoal ? "Meta atualizada" : "Meta criada" });
    setDialogOpen(false);
    load();
  }

  async function handleDelete(g: GoalProgress) {
    if (!storeId || !window.confirm(`Excluir meta de ${GOAL_META[g.goal_type]?.label}?`)) return;
    const { error } = await supabase.rpc("delete_finance_goal", { p_id: g.goal_id, p_store_id: storeId });
    if (error) { toast({ title: "Erro ao excluir", variant: "destructive" }); return; }
    toast({ title: "Meta excluída" });
    load();
  }

  const years = [now.getFullYear(), now.getFullYear() - 1];
  const existingTypes = new Set(goals.map((g) => g.goal_type));
  const availableTypes = Object.keys(GOAL_META).filter((k) => editGoal ? true : !existingTypes.has(k));

  const onTrackCount = goals.filter((g) => g.on_track).length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6 text-purple-600" />
            Metas Financeiras
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Acompanhe faturamento, lucro, recebimentos e inadimplência
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
          {canEdit && availableTypes.length > 0 && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Nova Meta
            </Button>
          )}
        </div>
      </div>

      {/* Resumo */}
      {goals.length > 0 && (
        <Card className={onTrackCount === goals.length ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-3">
              {onTrackCount === goals.length
                ? <CheckCircle className="h-5 w-5 text-emerald-600" />
                : <AlertCircle className="h-5 w-5 text-amber-600" />}
              <span className="font-medium text-sm">
                {onTrackCount}/{goals.length} meta(s) no ritmo para {MONTHS[month - 1]}/{year}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : goals.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <Target className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Nenhuma meta definida para {MONTHS[month - 1]}/{year}.</p>
          {canEdit && (
            <Button className="mt-3" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Criar primeira meta
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {goals.map((g) => {
            const meta = GOAL_META[g.goal_type] ?? { label: g.goal_type, unit: "BRL", icon: "📊", color: "text-slate-600" };
            const isInvert = g.goal_type === "inadimplencia"; // lower = better
            return (
              <Card key={g.goal_id} className={g.on_track ? "border-emerald-200" : "border-amber-200"}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{meta.icon}</span>
                      <div>
                        <p className="font-semibold">{meta.label}</p>
                        <p className="text-xs text-muted-foreground">
                          Meta: {meta.unit === "BRL" ? fmtBRL(g.target_value) : `${g.target_value}%`}
                          {isInvert && " (máximo)"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={g.on_track ? "default" : "secondary"}>
                        {g.on_track ? "No ritmo" : "Atenção"}
                      </Badge>
                      {canEdit && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(g)}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(g)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Realizado</span>
                      <span className={`font-bold ${meta.color}`}>
                        {meta.unit === "BRL" ? fmtBRL(g.realized) : `${g.realized.toFixed(1)}%`}
                      </span>
                    </div>
                    <ProgressBar pct={g.progress_pct} onTrack={g.on_track} />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{g.progress_pct.toFixed(1)}% {isInvert ? "atingida (menor = melhor)" : "da meta"}</span>
                      {g.realized < g.target_value && !isInvert && (
                        <span>
                          Falta: {meta.unit === "BRL" ? fmtBRL(g.target_value - g.realized) : `${(g.target_value - g.realized).toFixed(1)}%`}
                        </span>
                      )}
                    </div>
                  </div>

                  {g.notes && <p className="text-xs text-muted-foreground mt-2 italic">{g.notes}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editGoal ? "Editar meta" : "Nova meta"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editGoal && (
              <div className="space-y-1.5">
                <Label>Tipo de Meta</Label>
                <Select value={form.goal_type} onValueChange={(v) => setForm((f) => ({ ...f, goal_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {availableTypes.map((k) => (
                      <SelectItem key={k} value={k}>
                        {GOAL_META[k]?.icon} {GOAL_META[k]?.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>
                Meta ({GOAL_META[form.goal_type]?.unit === "PCT" ? "%" : "R$"})
                {form.goal_type === "inadimplencia" && (
                  <span className="text-xs text-muted-foreground ml-1">— limite máximo desejado</span>
                )}
              </Label>
              <Input
                type="number"
                min={0}
                step={form.goal_type === "inadimplencia" ? "0.1" : "100"}
                value={form.target_value}
                onChange={(e) => setForm((f) => ({ ...f, target_value: e.target.value }))}
                placeholder={form.goal_type === "inadimplencia" ? "Ex: 5 (para 5%)" : "Ex: 50000"}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Observações (opcional)</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                placeholder="Contexto da meta..."
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Período: {MONTHS[month - 1]}/{year}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.target_value}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {editGoal ? "Salvar" : "Criar meta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
