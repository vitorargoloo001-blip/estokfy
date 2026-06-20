import React, { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  Download, Filter, LogIn, Zap, CheckCircle2, Edit, Trash2, RefreshCw,
  ChevronDown, ChevronRight, ChevronLeft,
} from "lucide-react";
import { useConnectAudit } from "@/hooks/useConnectAudit";

const ACTION_TYPE_ICONS: Record<string, React.ReactNode> = {
  login:         <LogIn className="h-4 w-4" />,
  sync:          <Zap className="h-4 w-4" />,
  reconciliation: <CheckCircle2 className="h-4 w-4" />,
  update:        <Edit className="h-4 w-4" />,
  delete:        <Trash2 className="h-4 w-4" />,
  reprocess:     <RefreshCw className="h-4 w-4" />,
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  login:          "Login",
  sync:           "Sincronização",
  reconciliation: "Conciliação",
  update:         "Alteração",
  delete:         "Exclusão",
  reprocess:      "Reprocessamento",
};

const ACTION_TYPE_COLORS: Record<string, string> = {
  login:          "bg-blue-100 text-blue-800",
  sync:           "bg-yellow-100 text-yellow-800",
  reconciliation: "bg-green-100 text-green-800",
  update:         "bg-purple-100 text-purple-800",
  delete:         "bg-red-100 text-red-800",
  reprocess:      "bg-orange-100 text-orange-800",
};

const PAGE_SIZE = 100;

const PRESETS = [
  { label: "7d",    days: 7 },
  { label: "30d",   days: 30 },
  { label: "90d",   days: 90 },
];

function daysAgoISO(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

export default function ConnectAudit() {
  const { logs, summary, timeline, loading, loadAuditLogs, exportToCSV, exportToPDF } =
    useConnectAudit();

  const [filterActionType, setFilterActionType] = useState("all");
  const [filterEmail, setFilterEmail] = useState("");
  const [activeDays, setActiveDays] = useState<number | null>(30);
  const [page, setPage] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const applyPreset = useCallback(
    (days: number | null) => {
      setActiveDays(days);
      setPage(0);
      if (days === null) {
        loadAuditLogs({});
      } else {
        loadAuditLogs({ startDate: daysAgoISO(days) });
      }
    },
    [loadAuditLogs]
  );

  // re-filter on action type or email change (client-side, no RPC re-call)
  const filteredLogs = logs.filter((log) => {
    const matchesAction = filterActionType === "all" || log.action_type === filterActionType;
    const matchesEmail = !filterEmail || log.user_email?.toLowerCase().includes(filterEmail.toLowerCase());
    return matchesAction && matchesEmail;
  });

  const pageCount = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const pageLogs = filteredLogs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedIds(next);
  };

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString("pt-BR", {
      weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    });

  const formatTime = (date: string) =>
    new Date(date).toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Auditoria Financeira</h2>
        <p className="text-muted-foreground mt-1">Histórico completo de operações e acessos</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {summary.map((item) => (
          <Card key={item.action_type}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                {ACTION_TYPE_ICONS[item.action_type]}
                <div>
                  <p className="text-xs text-muted-foreground">
                    {ACTION_TYPE_LABELS[item.action_type]}
                  </p>
                  <p className="text-lg font-bold">{item.count}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Timeline Chart */}
      {timeline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Timeline de Atividades (30 dias)</CardTitle>
            <CardDescription>Operações por tipo e data</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(date) =>
                    new Date(date).toLocaleDateString("pt-BR", { month: "short", day: "numeric" })
                  }
                />
                <YAxis />
                <Tooltip
                  labelFormatter={(label) => new Date(label).toLocaleDateString("pt-BR")}
                />
                <Legend />
                <Bar dataKey="login"          fill="#3b82f6" name="Login" />
                <Bar dataKey="sync"           fill="#eab308" name="Sincronização" />
                <Bar dataKey="reconciliation" fill="#10b981" name="Conciliação" />
                <Bar dataKey="update_op"      fill="#a855f7" name="Alteração" />
                <Bar dataKey="delete_op"      fill="#ef4444" name="Exclusão" />
                <Bar dataKey="reprocess"      fill="#f97316" name="Reprocessamento" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filtros e Export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Presets de data */}
          <div>
            <label className="text-sm font-medium block mb-2">Período</label>
            <div className="flex gap-2 flex-wrap">
              {PRESETS.map(({ label, days }) => (
                <Button
                  key={label}
                  size="sm"
                  variant={activeDays === days ? "default" : "outline"}
                  onClick={() => applyPreset(days)}
                >
                  {label}
                </Button>
              ))}
              <Button
                size="sm"
                variant={activeDays === null ? "default" : "outline"}
                onClick={() => applyPreset(null)}
              >
                Todos
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium block mb-2">Tipo de Ação</label>
              <Select value={filterActionType} onValueChange={(v) => { setFilterActionType(v); setPage(0); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as ações" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as ações</SelectItem>
                  {Object.entries(ACTION_TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium block mb-2">Email do Usuário</label>
              <Input
                placeholder="Filtrar por email..."
                value={filterEmail}
                onChange={(e) => { setFilterEmail(e.target.value); setPage(0); }}
              />
            </div>

            <div className="flex items-end gap-2">
              <Button
                onClick={exportToCSV}
                variant="outline"
                className="flex-1"
                disabled={loading || logs.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
              <Button
                onClick={exportToPDF}
                variant="outline"
                className="flex-1"
                disabled={loading || logs.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                PDF
              </Button>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {filteredLogs.length} registro(s) encontrado(s)
            {filteredLogs.length > PAGE_SIZE && ` — página ${page + 1} de ${pageCount}`}
          </p>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Histórico de Auditoria</CardTitle>
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                {page + 1} / {pageCount}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : pageLogs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum registro de auditoria encontrado
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-4 font-semibold w-8"></th>
                    <th className="text-left py-3 px-4 font-semibold">Data/Hora</th>
                    <th className="text-left py-3 px-4 font-semibold">Usuário</th>
                    <th className="text-left py-3 px-4 font-semibold">Ação</th>
                    <th className="text-left py-3 px-4 font-semibold">Tipo</th>
                    <th className="text-left py-3 px-4 font-semibold">Entidade</th>
                    <th className="text-left py-3 px-4 font-semibold">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {pageLogs.map((log) => {
                    const expanded = expandedIds.has(log.id);
                    const hasDetails = log.details && Object.keys(log.details).length > 0;
                    return (
                      <React.Fragment key={log.id}>
                        <tr className="border-b hover:bg-muted/30 transition-colors">
                          <td className="py-3 px-4">
                            {hasDetails && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                onClick={() => toggleExpand(log.id)}
                              >
                                {expanded
                                  ? <ChevronDown className="h-3 w-3" />
                                  : <ChevronRight className="h-3 w-3" />}
                              </Button>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="text-xs">
                              <p className="font-medium">{formatDate(log.created_at)}</p>
                              <p className="text-muted-foreground">{formatTime(log.created_at)}</p>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <p className="text-xs">{log.user_email || "—"}</p>
                          </td>
                          <td className="py-3 px-4">
                            <p className="text-xs font-medium">{log.action}</p>
                          </td>
                          <td className="py-3 px-4">
                            <Badge className={ACTION_TYPE_COLORS[log.action_type] ?? "bg-gray-100 text-gray-800"}>
                              {ACTION_TYPE_LABELS[log.action_type] ?? log.action_type}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            <div className="text-xs">
                              <p className="font-medium">{log.entity_type}</p>
                              {log.entity_id && (
                                <p className="text-muted-foreground font-mono text-xs">
                                  {log.entity_id.slice(0, 8)}...
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <p className="text-xs font-mono text-muted-foreground">
                              {log.ip_address || "—"}
                            </p>
                          </td>
                        </tr>
                        {expanded && hasDetails && (
                          <tr className="border-b bg-muted/10">
                            <td colSpan={7} className="px-8 pb-3 pt-1">
                              <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">
                                {JSON.stringify(log.details, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
