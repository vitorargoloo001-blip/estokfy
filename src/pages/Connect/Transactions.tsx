import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Download, Filter, X } from "lucide-react";
import { useTransactions } from "@/hooks/useTransactions";
import { useBankConnections } from "@/hooks/useBankConnections";

export default function ConnectTransactions() {
  const { transactions, summary, loading, loadTransactions, updateStatus } = useTransactions();
  const { connections } = useBankConnections();
  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    bankConnectionId: "all",
    status: "all",
    minAmount: "",
    maxAmount: "",
  });

  const handleFilter = () => {
    loadTransactions({
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
      bankConnectionId: filters.bankConnectionId !== "all" ? filters.bankConnectionId : undefined,
      status: filters.status !== "all" ? filters.status : undefined,
      minAmount: filters.minAmount ? parseFloat(filters.minAmount) : undefined,
      maxAmount: filters.maxAmount ? parseFloat(filters.maxAmount) : undefined,
    });
  };

  const handleClearFilters = () => {
    setFilters({
      startDate: "",
      endDate: "",
      bankConnectionId: "all",
      status: "all",
      minAmount: "",
      maxAmount: "",
    });
    loadTransactions();
  };

  const handleExport = () => {
    if (!transactions.length) return;
    const headers = ["Data", "Valor", "Tipo", "Banco", "Metodo", "Descricao", "Status"];
    const rows = transactions.map((tx) => [
      formatDate(tx.transaction_date),
      String(tx.amount).replace(".", ","),
      tx.transaction_type === "credit" ? "Entrada" : "Saida",
      tx.bank_name ?? "",
      getMethodLabel(tx.method),
      (tx.description ?? "").replace(/[\r\n;]+/g, " "),
      tx.status,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transacoes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "reconciled":
        return <Badge className="bg-green-600">Conciliada</Badge>;
      case "pending":
        return <Badge variant="outline" className="text-yellow-600">Pendente</Badge>;
      case "divergent":
        return <Badge variant="destructive">Divergente</Badge>;
      case "ignored":
        return <Badge variant="secondary">Ignorada</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getMethodLabel = (method: string | null) => {
    const methods: Record<string, string> = {
      pix: "PIX",
      ted: "TED",
      doc: "DOC",
      cheque: "Cheque",
      boleto: "Boleto",
      other: "Outro",
    };
    return methods[method || ""] || method || "-";
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("pt-BR");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <CreditCard className="h-6 w-6" />
          Transações Bancárias
        </h2>
        <p className="text-muted-foreground mt-1">Histórico de transações sincronizadas</p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{summary.total_count}</div>
              <p className="text-xs text-muted-foreground">{formatCurrency(summary.total_amount)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Conciliadas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-green-600">{summary.reconciled_count}</div>
              <p className="text-xs text-muted-foreground">{formatCurrency(summary.reconciled_amount)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pendentes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-yellow-600">{summary.pending_count}</div>
              <p className="text-xs text-muted-foreground">{formatCurrency(summary.pending_amount)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Divergentes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-red-600">{summary.divergent_count}</div>
              <p className="text-xs text-muted-foreground">{formatCurrency(summary.divergent_amount)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Ignoradas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{summary.ignored_count}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="text-xs font-medium">Data Inicial</label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium">Data Final</label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium">Banco</label>
              <Select value={filters.bankConnectionId} onValueChange={(v) => setFilters({ ...filters, bankConnectionId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.bank_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">Status</label>
              <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="reconciled">Conciliada</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="divergent">Divergente</SelectItem>
                  <SelectItem value="ignored">Ignorada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">Valor Mín</label>
              <Input
                type="number"
                placeholder="0"
                value={filters.minAmount}
                onChange={(e) => setFilters({ ...filters, minAmount: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium">Valor Máx</label>
              <Input
                type="number"
                placeholder="0"
                value={filters.maxAmount}
                onChange={(e) => setFilters({ ...filters, maxAmount: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={handleFilter} size="sm">
              Aplicar Filtros
            </Button>
            <Button onClick={handleClearFilters} variant="outline" size="sm">
              <X className="h-4 w-4 mr-1" />
              Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Transações</CardTitle>
              <CardDescription>{transactions.length} resultado(s)</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={transactions.length === 0}>
              <Download className="h-4 w-4 mr-1" />
              Exportar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Nenhuma transação encontrada</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Banco</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-medium">{formatDate(tx.transaction_date)}</TableCell>
                      <TableCell>
                        <span className={tx.transaction_type === "credit" ? "text-green-600 font-semibold" : "text-red-600"}>
                          {tx.transaction_type === "credit" ? "+" : "-"} {formatCurrency(tx.amount)}
                        </span>
                      </TableCell>
                      <TableCell className="capitalize">{tx.transaction_type === "credit" ? "Entrada" : "Saída"}</TableCell>
                      <TableCell className="text-sm">{tx.bank_name}</TableCell>
                      <TableCell className="text-sm">{getMethodLabel(tx.method)}</TableCell>
                      <TableCell className="text-sm max-w-xs truncate">{tx.description || "-"}</TableCell>
                      <TableCell>{getStatusBadge(tx.status)}</TableCell>
                      <TableCell className="text-right">
                        <Select value={tx.status} onValueChange={(v) => updateStatus(tx.id, v)}>
                          <SelectTrigger className="w-24 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pendente</SelectItem>
                            <SelectItem value="reconciled">Conciliada</SelectItem>
                            <SelectItem value="divergent">Divergente</SelectItem>
                            <SelectItem value="ignored">Ignorada</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
