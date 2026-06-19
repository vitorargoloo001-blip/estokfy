import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon } from 'lucide-react';
import { invokeEdgeFunction } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface BatchSale {
  id: string;
  created_at: string;
  due_date: string | null;
  amount_pending: number;
  description?: string;
}

interface Props {
  customerName: string;
  sales: BatchSale[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettled?: () => void;
}

const METHODS = [
  { value: 'pix', label: 'PIX' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'credit_card', label: 'Cartão Crédito' },
  { value: 'debit_card', label: 'Cartão Débito' },
  { value: 'transfer', label: 'Transferência' },
];

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function BatchSettlePaymentDialog({ customerName, sales, open, onOpenChange, onSettled }: Props) {
  const totalPending = useMemo(
    () => sales.reduce((s, r) => s + Number(r.amount_pending), 0),
    [sales],
  );

  // Ordem de abatimento:
  // 1) vencidas mais antigas (due_date < hoje, asc)
  // 2) sem vencimento, mais antigas (created_at asc)
  // 3) a vencer (due_date >= hoje, asc)
  const ordered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const bucket = (s: BatchSale) => {
      if (!s.due_date) return 1;
      return s.due_date < today ? 0 : 2;
    };
    const copy = [...sales];
    copy.sort((a, b) => {
      const ba = bucket(a), bb = bucket(b);
      if (ba !== bb) return ba - bb;
      if (ba === 1) return a.created_at < b.created_at ? -1 : 1;
      const ad = a.due_date || '9999-12-31';
      const bd = b.due_date || '9999-12-31';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.created_at < b.created_at ? -1 : 1;
    });
    return copy;
  }, [sales]);

  const [method, setMethod] = useState('pix');
  const [amount, setAmount] = useState(totalPending);
  const [paidAt, setPaidAt] = useState<Date>(new Date());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(totalPending);
      setMethod('pix');
      setPaidAt(new Date());
      setNote('');
    }
  }, [open, totalPending]);

  const remaining = Math.max(0, totalPending - amount);

  const handleSubmit = async () => {
    if (sales.length === 0) return;
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Valor inválido'); return; }
    if (amount > totalPending + 0.01) { toast.error(`Valor máximo: ${fmt(totalPending)}`); return; }
    if (note.length > 500) { toast.error('A observação pode ter no máximo 500 caracteres.'); return; }

    setSubmitting(true);
    let remainder = amount;
    let okCount = 0;
    const errs: string[] = [];
    const paidIso = paidAt.toISOString();

    try {
      for (let i = 0; i < ordered.length; i++) {
        if (remainder <= 0.0001) break;
        const s = ordered[i];
        const pay = Math.min(s.amount_pending, remainder);
        // Round to 2 decimals to avoid float drift
        const payRounded = Math.round(pay * 100) / 100;
        if (payRounded <= 0) continue;

        try {
          await invokeEdgeFunction('sales-settle-payment', {
            headers: { 'Idempotency-Key': crypto.randomUUID() },
            body: {
              sale_id: s.id,
              payments: [{ method, amount: payRounded }],
              paid_at: paidIso,
              note: note.trim() ? `[Lote] ${note.trim()}` : `[Lote] Recebimento agrupado — ${customerName}`,
            },
          });
          okCount++;
          remainder = Math.round((remainder - payRounded) * 100) / 100;
        } catch (e: any) {
          errs.push(`#${s.id.slice(0, 6)}: ${e?.message || 'erro'}`);
        }
      }

      if (okCount > 0 && errs.length === 0) {
        toast.success(`Recebimento registrado em ${okCount} conta(s)`);
        onOpenChange(false);
        onSettled?.();
      } else if (okCount > 0 && errs.length > 0) {
        toast.warning(`Parcial: ${okCount} ok, ${errs.length} com erro`);
        onSettled?.();
      } else {
        toast.error(errs[0] || 'Falha ao registrar recebimento');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Preview allocation
  const allocation = useMemo(() => {
    let rem = amount;
    return ordered.map((s) => {
      const pay = Math.min(s.amount_pending, Math.max(0, rem));
      rem = Math.max(0, rem - pay);
      const payRounded = Math.round(pay * 100) / 100;
      return {
        ...s,
        will_pay: payRounded,
        will_remain: Math.round((s.amount_pending - payRounded) * 100) / 100,
      };
    });
  }, [ordered, amount]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lançar pagamento — {customerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-muted/40 border p-3">
              <p className="text-[11px] text-muted-foreground">Selecionadas</p>
              <p className="text-lg font-bold">{sales.length}</p>
            </div>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-3">
              <p className="text-[11px] text-amber-700 dark:text-amber-400">Total a receber</p>
              <p className="text-lg font-bold text-amber-900 dark:text-amber-300">{fmt(totalPending)}</p>
            </div>
            <div className="rounded-lg bg-card border p-3">
              <p className="text-[11px] text-muted-foreground">Restante após</p>
              <p className="text-lg font-bold text-destructive">{fmt(remaining)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Forma de recebimento</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Data do recebimento</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-full h-11 justify-start text-left font-normal')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(paidAt, 'dd/MM/yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={paidAt} onSelect={d => d && setPaidAt(d)} initialFocus className={cn('p-3 pointer-events-auto')} />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Valor recebido total</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              max={totalPending}
              value={amount}
              onChange={e => setAmount(parseFloat(e.target.value) || 0)}
              className="h-11"
            />
            {amount < totalPending && amount > 0 && (
              <p className="text-xs text-muted-foreground">
                Recebimento parcial. Será aplicado nas contas mais antigas primeiro.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Contas incluídas</Label>
            <ScrollArea className="max-h-[200px] rounded-lg border">
              <div className="divide-y">
                {allocation.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        {s.description || `Venda #${s.id.slice(0, 6)}`}
                      </p>
                      <p className="text-muted-foreground">
                        {new Date(s.created_at).toLocaleDateString('pt-BR')}
                        {s.due_date ? ` · venc ${new Date(s.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-muted-foreground">Pendente: {fmt(s.amount_pending)}</p>
                      <p className={cn('font-semibold', s.will_pay > 0 ? 'text-emerald-600' : 'text-muted-foreground')}>
                        Quitar: {fmt(s.will_pay)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-2">
            <Label htmlFor="batch-note">Observação (opcional)</Label>
            <Textarea
              id="batch-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={2}
              placeholder="Ex.: Cliente pagou em mãos as 3 contas atrasadas"
              className="w-full resize-y"
            />
            <p className="text-xs text-muted-foreground text-right">{note.length}/500</p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-11" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button className="flex-1 h-11" disabled={submitting || amount <= 0 || sales.length === 0} onClick={handleSubmit}>
              {submitting ? 'Registrando...' : `Receber ${fmt(amount)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
