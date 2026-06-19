import { useState, useEffect } from 'react';
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

interface SettlePaymentDialogProps {
  saleId: string | null;
  amountPending: number;
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

export default function SettlePaymentDialog({ saleId, amountPending, open, onOpenChange, onSettled }: SettlePaymentDialogProps) {
  const [method, setMethod] = useState('pix');
  const [amount, setAmount] = useState(amountPending);
  const [paidAt, setPaidAt] = useState<Date>(new Date());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(amountPending);
      setMethod('pix');
      setPaidAt(new Date());
      setNote('');
    }
  }, [open, amountPending]);

  const handleSubmit = async () => {
    if (!saleId) return;
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Valor inválido'); return; }
    if (amount > amountPending + 0.01) { toast.error(`Valor máximo: ${fmt(amountPending)}`); return; }
    if (note.length > 500) { toast.error('A observação pode ter no máximo 500 caracteres.'); return; }

    setSubmitting(true);
    try {
      const result = await invokeEdgeFunction<{ payment_status: string }>('sales-settle-payment', {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          sale_id: saleId,
          payments: [{ method, amount }],
          paid_at: paidAt.toISOString(),
          note: note.trim() || null,
        },
      });
      toast.success(result.payment_status === 'paid' ? 'Venda quitada!' : 'Pagamento registrado!');
      onOpenChange(false);
      onSettled?.();
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao registrar pagamento');
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Receber pagamento</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-3">
            <p className="text-xs text-amber-700 dark:text-amber-400">Saldo devedor</p>
            <p className="text-2xl font-bold text-amber-900 dark:text-amber-300">{fmt(amountPending)}</p>
          </div>
          <div className="space-y-2">
            <Label>Forma de recebimento</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Valor recebido</Label>
            <Input type="number" step="0.01" min="0" max={amountPending} value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className="h-11" />
            {amount < amountPending && amount > 0 && (
              <p className="text-xs text-muted-foreground">Quitação parcial. Restará {fmt(amountPending - amount)}.</p>
            )}
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
          <div className="space-y-2">
            <Label htmlFor="settle-note">Observação (opcional)</Label>
            <Textarea
              id="settle-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={3}
              placeholder={'Ex.: Pagamento parcial combinado via WhatsApp\nCliente solicitou prazo extra\nRecebido após renegociação'}
              className="w-full resize-y"
            />
            <p className="text-xs text-muted-foreground text-right">{note.length}/500</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-11" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button className="flex-1 h-11" disabled={submitting || amount <= 0} onClick={handleSubmit}>
              {submitting ? 'Registrando...' : 'Confirmar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
