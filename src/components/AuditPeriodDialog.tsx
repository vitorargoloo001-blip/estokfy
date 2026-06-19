import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, CheckCircle2, FileSearch } from 'lucide-react';
import { fetchFinancialSummary, labelMethod, type FinancialSummary } from '@/lib/financialReport';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  from: string;
  to: string;
  employeeId?: string | null;
}

const fmt = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export default function AuditPeriodDialog({
  open, onOpenChange, storeId, from, to, employeeId,
}: Props) {
  const [data, setData] = useState<FinancialSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchFinancialSummary({ storeId, from, to, employeeId })
      .then(setData)
      .catch((e) => {
        toast.error('Falha ao carregar auditoria: ' + (e?.message || ''));
      })
      .finally(() => setLoading(false));
  }, [open, storeId, from, to, employeeId]);

  const byMethod = data?.received.by_method ?? {};
  const methodEntries = Object.entries(byMethod).sort((a, b) => b[1].amount - a[1].amount);
  const byMethodSum = methodEntries.reduce((s, [, v]) => s + v.amount, 0);
  const hasDivergence = data && Math.abs(byMethodSum - data.received.total) > 0.01;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch className="h-5 w-5 text-primary" />
            Auditoria do período · {from} → {to}
          </DialogTitle>
          <DialogDescription>
            Mostra exatamente quais pagamentos, vendas e despesas foram usados no cálculo do relatório.
            Use esta tela para verificar divergências entre Vendas, Contas a Receber, Financeiro e Relatórios.
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {data && (
          <ScrollArea className="flex-1 pr-3">
            {/* Resumo por método */}
            <div className="rounded-lg border p-4 mb-4 bg-muted/30">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Recebido por forma de pagamento</h3>
                {hasDivergence ? (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" /> Divergência
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-green-500 text-green-700">
                    <CheckCircle2 className="h-3 w-3" /> Consistente
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                {methodEntries.map(([m, v]) => (
                  <div key={m} className="rounded-md border bg-background p-3">
                    <p className="text-xs text-muted-foreground">{labelMethod(m)}</p>
                    <p className="text-lg font-semibold">{fmt(v.amount)}</p>
                    <p className="text-xs text-muted-foreground">{v.count} pagto(s)</p>
                  </div>
                ))}
              </div>
              <div className="text-sm flex flex-wrap gap-4">
                <span>Total: <strong>{fmt(data.received.total)}</strong></span>
                <span>Soma por método: <strong>{fmt(byMethodSum)}</strong></span>
                {data.received.ignored_count > 0 && (
                  <span className="text-amber-600">
                    Ignorados (cancelados/excluídos): {data.received.ignored_count} · {fmt(data.received.ignored_amount)}
                  </span>
                )}
              </div>
            </div>

            <Tabs defaultValue="used">
              <TabsList>
                <TabsTrigger value="used">
                  Pagamentos usados ({data.audit.payments_used.length})
                </TabsTrigger>
                <TabsTrigger value="ignored">
                  Ignorados ({data.audit.payments_ignored.length})
                </TabsTrigger>
                <TabsTrigger value="sales_ignored">
                  Vendas ignoradas ({data.audit.sales_ignored.length})
                </TabsTrigger>
                <TabsTrigger value="duplicates">
                  Duplicidades ({data.audit.possible_duplicates.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="used" className="mt-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data/hora</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead>Venda</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.audit.payments_used.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{fmtDateTime(p.paid_at)}</TableCell>
                        <TableCell><Badge variant="secondary">{labelMethod(p.method)}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{p.sale_id?.slice(0, 8) ?? '—'}</TableCell>
                        <TableCell className="text-right font-medium">{fmt(Number(p.amount))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="ignored" className="mt-3">
                {data.audit.payments_ignored.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4">Nenhum pagamento ignorado.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data/hora</TableHead>
                        <TableHead>Método</TableHead>
                        <TableHead>Venda / Motivo</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.audit.payments_ignored.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{fmtDateTime(p.paid_at)}</TableCell>
                          <TableCell><Badge variant="secondary">{labelMethod(p.method)}</Badge></TableCell>
                          <TableCell className="text-xs">
                            {p.sale_id?.slice(0, 8) ?? '—'} ·{' '}
                            <span className="text-amber-600">
                              {p.s_deleted_at ? 'venda excluída' : `status: ${p.s_status}`}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">{fmt(Number(p.amount))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              <TabsContent value="sales_ignored" className="mt-3">
                {data.audit.sales_ignored.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4">Nenhuma venda foi ignorada no período.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Excluída em</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.audit.sales_ignored.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono text-xs">{s.id.slice(0, 8)}</TableCell>
                          <TableCell><Badge variant="outline">{s.status}</Badge></TableCell>
                          <TableCell className="text-xs">
                            {s.deleted_at ? fmtDateTime(s.deleted_at) : '—'}
                          </TableCell>
                          <TableCell className="text-right">{fmt(Number(s.net_total))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              <TabsContent value="duplicates" className="mt-3">
                {data.audit.possible_duplicates.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4">
                    Nenhuma duplicidade detectada. ✅
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Venda</TableHead>
                        <TableHead>Método</TableHead>
                        <TableHead>Dia</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead className="text-right">Ocorrências</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.audit.possible_duplicates.map((d, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{d.sale_id.slice(0, 8)}</TableCell>
                          <TableCell><Badge variant="secondary">{labelMethod(d.method)}</Badge></TableCell>
                          <TableCell className="text-xs">{d.day}</TableCell>
                          <TableCell className="text-right">{fmt(Number(d.amount))}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="destructive">{d.occurrences}x</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
            </Tabs>
          </ScrollArea>
        )}

        <div className="flex justify-end pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
