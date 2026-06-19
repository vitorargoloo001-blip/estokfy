import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Download, Filter, LogIn, Zap, CheckCircle2, Edit, Trash2, RefreshCw } from "lucide-react";
import { useConnectAudit } from "@/hooks/useConnectAudit";

const ACTION_TYPE_ICONS: Record<string, React.ReactNode> = {
  login: <LogIn className="h-4 w-4" />,
  sync: <Zap className="h-4 w-4" />,
  reconciliation: <CheckCircle2 className="h-4 w-4" />,
  update: <Edit className="h-4 w-4" />,
  delete: <Trash2 className="h-4 w-4" />,
  reprocess: <RefreshCw className="h-4 w-4" />,
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  login: "Login",
  sync: "Sincronização",
  reconciliation: "Conciliação",
  update: "Alteração",
  delete: "Exclusão",
  reprocess: "Reprocessamento",
};

const ACTION_TYPE_COLORS: Record<string, string> = {
  login: "bg-blue-100 text-blue-800",
  sync: "bg-yellow-100 text-yellow-800",
  reconciliation: "bg-green-100 text-green-800",
  update: "bg-purple-100 text-purple-800",
  delete: "bg-red-100 text-red-800",
  reprocess: "bg-orange-100 text-orange-800",
};

export default function ConnectAudit() {
  const { logs, summary, timeline, loading, exportToCSV, exportToPDF } = useConnectAudit();
  const [filterActionType, setFilterActionType] = useState<string>("all");
  const [filterEmail, setFilterEmail] = useState("");

  const filteredLogs = logs.filter((log) => {
    const matchesAction = filterActionType === "all" || log.action_type === filterActionType;
    const matchesEmail = !filterEmail || log.user_email?.includes(filterEmail);
    return matchesAction && matchesEmail;
  });

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("pt-BR", {
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const formatTime = (date: string) => {
    return new Date(date).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          Auditoria Financeira
        </h2>
        <p className="text-muted-foreground mt-1">
          Histórico completo de operações e acessos
        </p>
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
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(date) =>
                    new Date(date).toLocaleDateString("pt-BR", {
                      month: "short",
                      day: "numeric",
                    })
                  }
                />
                <YAxis />
                <Tooltip
                  formatter={(value) => value}
                  labelFormatter={(label) =>
                    new Date(label).toLocaleDateString("pt-BR")
                  }
                />
                <Legend />
                <Bar dataKey="login" fill="#3b82f6" name="Login" />
                <Bar dataKey="sync" fill="#eab308" name="Sincronização" />
                <Bar dataKey="reconciliation" fill="#10b981" name="Conciliação" />
                <Bar dataKey="update_op" fill="#a855f7" name="Alteração" />
                <Bar dataKey="delete_op" fill="#ef4444" name="Exclusão" />
                <Bar dataKey="reprocess" fill="#f97316" name="Reprocessamento" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Filters and Export */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium block mb-2">Tipo de Ação</label>
              <Select value={filterActionType} onValueChange={setFilterActionType}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as ações" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as ações</SelectItem>
                  {Object.entries(ACTION_TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium block mb-2">Email do Usuário</label>
              <Input
                placeholder="Filtrar por email..."
                value={filterEmail}
                onChange={(e) => setFilterEmail(e.target.value)}
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
          </p>
        </CardContent>
      </Card>

      {/* Audit Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico de Auditoria</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum registro de auditoria encontrado
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-4 font-semibold">Data/Hora</th>
                    <th className="text-left py-3 px-4 font-semibold">Usuário</th>
                    <th className="text-left py-3 px-4 font-semibold">Ação</th>
                    <th className="text-left py-3 px-4 font-semibold">Tipo</th>
                    <th className="text-left py-3 px-4 font-semibold">Entidade</th>
                    <th className="text-left py-3 px-4 font-semibold">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="border-b hover:bg-muted/30 transition-colors">
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
                        <Badge className={ACTION_TYPE_COLORS[log.action_type]}>
                          {ACTION_TYPE_LABELS[log.action_type]}
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
