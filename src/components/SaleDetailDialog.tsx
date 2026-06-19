import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Package, CreditCard, Truck, Clock, CheckCircle2, AlertCircle, StickyNote } from 'lucide-react';
import ReceiptActions from './ReceiptActions';

interface SaleDetailDialogProps {
  saleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SaleItem {
  id: string;
  qty: number;
  unit_price: number;
  unit_cost: number;
  line_total: number;
  products: { name: string } | null;
}

interface Payment {
  id: string;
  method: string;
  amount: number;
  provider: string | null;
  paid_at: string;
}

interface Delivery {
  id: string;
  method: string;
  status: string;
  tracking_code: string | null;
  delivery_cost: number;
  delivered_at: string | null;
  created_at: string;
}

interface SaleSummary {
  net_total: number;
  amount_paid: number;
  amount_pending: number;
  payment_status: string;
  due_date: string | null;
  created_at: string;
  notes: string | null;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const methodLabels: Record<string, string> = {
  cash: 'Dinheiro', pix: 'PIX', credit_card: 'Cartão Crédito',
  debit_card: 'Cartão Débito', transfer: 'Transferência', boleto: 'Boleto',
  pending: 'A prazo / Pendente', other: 'Outro',
};

const deliveryMethodLabels: Record<string, string> = {
  pickup: 'Retirada', courier: 'Motoboy', shipping: 'Transportadora',
  correios: 'Correios', app_99: '99', other: 'Outro',
};

const deliveryStatusLabels: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pendente', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  in_transit: { label: 'Em trânsito', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  delivered: { label: 'Entregue', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  cancelled: { label: 'Cancelado', cls: 'bg-destructive/10 text-destructive' },
};

export default function SaleDetailDialog({ saleId, open, onOpenChange }: SaleDetailDialogProps) {
  const [items, setItems] = useState<SaleItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [sale, setSale] = useState<SaleSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!saleId || !open) return;
    setLoading(true);

    Promise.all([
      supabase.from('sale_items').select('*, products(name)').eq('sale_id', saleId),
      supabase.from('payments').select('*').eq('sale_id', saleId).order('paid_at'),
      supabase.from('deliveries').select('*').eq('sale_id', saleId),
      supabase.from('sales').select('net_total, amount_paid, amount_pending, payment_status, due_date, created_at, notes').eq('id', saleId).maybeSingle(),
    ]).then(([itemsRes, paymentsRes, deliveriesRes, saleRes]) => {
      setItems((itemsRes.data || []) as unknown as SaleItem[]);
      setPayments((paymentsRes.data || []) as unknown as Payment[]);
      setDeliveries((deliveriesRes.data || []) as unknown as Delivery[]);
      setSale((saleRes.data || null) as SaleSummary | null);
      setLoading(false);
    });
  }, [saleId, open]);

  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = sale?.due_date && sale.due_date < today && (sale.payment_status === 'pending' || sale.payment_status === 'partial');
  const statusBadge = sale ? (
    sale.payment_status === 'paid' ? { label: 'Pago', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', Icon: CheckCircle2 } :
    sale.payment_status === 'partial' ? { label: 'Parcial', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', Icon: Clock } :
    isOverdue ? { label: 'Vencida', cls: 'bg-destructive/10 text-destructive', Icon: AlertCircle } :
    { label: 'Pendente', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', Icon: Clock }
  ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Detalhes da Venda
              </DialogTitle>
              <DialogDescription>
                {saleId ? `ID: ${saleId.slice(0, 8)}...` : ''}
              </DialogDescription>
            </div>
            {saleId && <ReceiptActions saleId={saleId} />}
          </div>
        </DialogHeader>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Payment status summary */}
            {sale && statusBadge && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <statusBadge.Icon className="h-4 w-4" />
                    <span className="text-sm font-semibold">Status do pagamento</span>
                  </div>
                  <Badge className={statusBadge.cls}>{statusBadge.label}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Total</p>
                    <p className="font-semibold text-sm">{fmt(Number(sale.net_total))}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Recebido</p>
                    <p className="font-semibold text-sm text-emerald-600 dark:text-emerald-400">{fmt(Number(sale.amount_paid))}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Pendente</p>
                    <p className={`font-semibold text-sm ${Number(sale.amount_pending) > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>{fmt(Number(sale.amount_pending))}</p>
                  </div>
                </div>
                {sale.due_date && (
                  <p className={`text-xs ${isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                    Vencimento: {new Date(sale.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                    {isOverdue && ' (vencida)'}
                  </p>
                )}
              </div>
            )}

            {/* Items */}
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Package className="h-4 w-4" /> Itens ({items.length})
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Unitário</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm font-medium">{item.products?.name || '-'}</TableCell>
                      <TableCell className="text-right text-sm">{item.qty}</TableCell>
                      <TableCell className="text-right text-sm">{fmt(item.unit_price)}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{fmt(item.line_total)}</TableCell>
                    </TableRow>
                  ))}
                  {items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-4">Nenhum item</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <Separator />

            {/* Payments */}
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <CreditCard className="h-4 w-4" /> Pagamentos ({payments.length})
              </h3>
              <div className="space-y-2">
                {payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-sm font-medium">{methodLabels[p.method] || p.method}</span>
                      {p.provider && <span className="text-xs text-muted-foreground ml-2">({p.provider})</span>}
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-semibold">{fmt(p.amount)}</span>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.paid_at).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  </div>
                ))}
                {payments.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-2">Nenhum pagamento</p>
                )}
              </div>
            </div>

            {sale?.notes && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <StickyNote className="h-4 w-4" /> Observações
                  </h3>
                  <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40 px-3 py-2">
                    <p className="text-sm whitespace-pre-wrap break-words text-amber-900 dark:text-amber-100">{sale.notes}</p>
                  </div>
                </div>
              </>
            )}

            {/* Delivery */}
            {deliveries.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Truck className="h-4 w-4" /> Entrega
                  </h3>
                  {deliveries.map(d => {
                    const ds = deliveryStatusLabels[d.status] || { label: d.status, cls: 'bg-muted text-muted-foreground' };
                    return (
                      <div key={d.id} className="bg-muted/50 rounded-lg px-3 py-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{deliveryMethodLabels[d.method] || d.method}</span>
                          <Badge className={ds.cls}>{ds.label}</Badge>
                        </div>
                        {d.tracking_code && (
                          <p className="text-xs text-muted-foreground">Rastreio: {d.tracking_code}</p>
                        )}
                        {d.delivery_cost > 0 && (
                          <p className="text-xs text-muted-foreground">Custo: {fmt(d.delivery_cost)}</p>
                        )}
                        {d.delivered_at && (
                          <p className="text-xs text-muted-foreground">
                            Entregue em: {new Date(d.delivered_at).toLocaleString('pt-BR')}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
