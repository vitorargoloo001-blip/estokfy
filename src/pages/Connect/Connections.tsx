import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Clock, Plus, Trash2, RefreshCw, TestTube } from "lucide-react";
import { useBankConnections } from "@/hooks/useBankConnections";

export default function ConnectBankConnections() {
  const { connections, syncHistory, loading, addConnection, removeConnection, recordSync, loadSyncHistory } = useBankConnections();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    bankName: "",
    agency: "",
    accountNumber: "",
    accountType: "checking",
    accountHolder: "",
  });

  const handleAddConnection = async () => {
    if (!formData.bankName || !formData.accountNumber) {
      alert("Preencha os campos obrigatórios");
      return;
    }

    const success = await addConnection(
      formData.bankName,
      formData.agency,
      formData.accountNumber,
      formData.accountType,
      formData.accountHolder
    );

    if (success) {
      setShowAddDialog(false);
      setFormData({ bankName: "", agency: "", accountNumber: "", accountType: "checking", accountHolder: "" });
    }
  };

  const handleSync = async (connectionId: string) => {
    // Real bank sync (Pluggy) is not enabled yet — record an honest no-op sync (0 found/0 imported)
    // instead of fabricating transactions. Will be wired to the provider in the Pluggy phase.
    setSyncingId(connectionId);
    try {
      await recordSync(connectionId, "success", 0, 0);
    } finally {
      setSyncingId(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "connected":
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-600" />;
      case "error":
      case "disconnected":
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "connected":
        return <Badge variant="default" className="bg-green-600">Conectado</Badge>;
      case "pending":
        return <Badge variant="outline" className="text-yellow-600">Pendente</Badge>;
      case "error":
        return <Badge variant="destructive">Erro</Badge>;
      case "disconnected":
        return <Badge variant="secondary">Desconectado</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Conexões Bancárias</h2>
          <p className="text-muted-foreground mt-1">Gerenciar contas bancárias conectadas</p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar Banco
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar Conexão Bancária</DialogTitle>
              <DialogDescription>Adicione uma nova conta bancária para sincronizar transações</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Banco *</label>
                <Input
                  placeholder="Ex: Banco do Brasil"
                  value={formData.bankName}
                  onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Agência</label>
                  <Input
                    placeholder="0001"
                    value={formData.agency}
                    onChange={(e) => setFormData({ ...formData, agency: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Conta *</label>
                  <Input
                    placeholder="123456"
                    value={formData.accountNumber}
                    onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Tipo de Conta</label>
                <Select value={formData.accountType} onValueChange={(v) => setFormData({ ...formData, accountType: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="checking">Corrente</SelectItem>
                    <SelectItem value="savings">Poupança</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Titular da Conta</label>
                <Input
                  placeholder="Nome do proprietário"
                  value={formData.accountHolder}
                  onChange={(e) => setFormData({ ...formData, accountHolder: e.target.value })}
                />
              </div>
              <Button onClick={handleAddConnection} className="w-full">
                Adicionar Conexão
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Connections Table */}
      <Card>
        <CardHeader>
          <CardTitle>Contas Conectadas</CardTitle>
          <CardDescription>Liste de {connections.length} conta(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : connections.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Nenhuma conexão bancária configurada</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Banco</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Última Sincronização</TableHead>
                  <TableHead>Transações</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((conn) => (
                  <TableRow key={conn.id}>
                    <TableCell className="font-medium">{conn.bank_name}</TableCell>
                    <TableCell>
                      {conn.agency && `${conn.agency} - `}
                      {conn.account_number}
                    </TableCell>
                    <TableCell className="capitalize">
                      {conn.account_type === "checking"
                        ? "Corrente"
                        : conn.account_type === "savings"
                          ? "Poupança"
                          : "Outro"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(conn.status)}
                        {getStatusBadge(conn.status)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {conn.last_sync_at
                        ? new Date(conn.last_sync_at).toLocaleDateString("pt-BR", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Nunca"}
                    </TableCell>
                    <TableCell>{conn.total_transactions}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSync(conn.id)}
                        disabled={syncingId === conn.id}
                      >
                        {syncingId === conn.id ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          loadSyncHistory(conn.id);
                          setSelectedConnection(conn.id);
                        }}
                      >
                        Histórico
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeConnection(conn.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Sync History */}
      {selectedConnection && syncHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Histórico de Sincronizações</CardTitle>
            <CardDescription>Últimas {syncHistory.length} sincronizações</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Encontradas</TableHead>
                  <TableHead>Importadas</TableHead>
                  <TableHead>Ignoradas</TableHead>
                  <TableHead>Duração</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncHistory.map((hist) => (
                  <TableRow key={hist.id}>
                    <TableCell className="text-sm">
                      {new Date(hist.sync_started_at).toLocaleDateString("pt-BR", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell>
                      {hist.status === "success" ? (
                        <Badge className="bg-green-600">Sucesso</Badge>
                      ) : hist.status === "pending" ? (
                        <Badge variant="outline">Pendente</Badge>
                      ) : hist.status === "failed" ? (
                        <Badge variant="destructive">Falhou</Badge>
                      ) : (
                        <Badge variant="secondary">{hist.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell>{hist.transactions_found}</TableCell>
                    <TableCell>{hist.transactions_imported}</TableCell>
                    <TableCell>{hist.transactions_skipped}</TableCell>
                    <TableCell className="text-sm">
                      {hist.duration_minutes ? `${hist.duration_minutes.toFixed(1)}min` : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
