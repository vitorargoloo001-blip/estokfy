import { useState, useRef, useEffect, useMemo } from 'react';
import { cents, validPaymentAmount, runPaymentSequence } from '@/lib/receivables';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon } from 'lucide-react';
import { invokeEdgeFunction } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface SettleItem {
  id: string; // sale_item_id
  name: string;
  qty: number;
  line_total: number;
  paid: number;
  balance: number;
}

export interface SettleSaleGroup {
  id: string; // sale_id
  created_at: string;
  due_date: string | null;
  items: SettleItem[];
}

interface Props {
  customerName: string;
  sales: SettleSaleGroup[];
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

export default function ItemSettlePaymentDialog({ customerName, sales, open, onOpenChange, onSettled }: Props) {
  // sale_item_id -> valor a pagar (só existe entrada pra item marcado)
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [method, setMethod] = useState('pix');
  const [paidAt, setPaidAt] = useState<Date>(new Date());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);

  useEffect(() => {
    if (open) {
      setSelected({});
      setMethod('pix');
      setPaidAt(new Date());
      setNote('');
    }
  }, [open]);

  const itemToSale = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sales) for (const it of s.items) map.set(it.id, s.id);
    return map;
  }, [sales]);

  const toggleItem = (item: SettleItem, checked: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[item.id] = item.balance;
      else delete next[item.id];
      return next;
    });
  };

  const updateAmount = (item: SettleItem, value: number) => {
    const capped = Math.max(0, Math.min(value, item.balance));
    setSelected((prev) => ({ ...prev, [item.id]: capped }));
  };

  const selectedCount = Object.keys(selected).length;
  const total = Object.values(selected).reduce((s, v) => s + v, 0);

  const handleSubmit = async () => {
    if (submitLock.current) return;
    if (selectedCount === 0) { toast.error('Selecione ao menos um item'); return; }
    if (!validPaymentAmount(total) || Object.values(selected).some(v => !validPaymentAmount(v))) {
      toast.error('Informe valores positivos com no máximo duas casas decimais.'); return;
    }
    if (note.length > 500) { toast.error('A observação pode ter no máximo 500 caracteres.'); return; }
    const bySale = new Map<string, { sale_item_id: string; amount: number }[]>();
    for (const [itemId, amount] of Object.entries(selected)) {
      const saleId = itemToSale.get(itemId);
      const item = sales.find(s => s.id === saleId)?.items.find(it => it.id === itemId);
      if (!saleId || !item || cents(amount) > cents(item.balance)) {
        toast.error('Os itens mudaram. Feche a janela e confira os saldos.'); return;
      }
      const list = bySale.get(saleId) || [];
      list.push({ sale_item_id: itemId, amount: cents(amount) / 100 });
      bySale.set(saleId, list);
    }
    submitLock.current = true;
    setSubmitting(true);
    try {
      // The RPC locks the sale and validates the exact requested values atomically.
      const result = await runPaymentSequence([...bySale], ([saleId, allocations]) =>
        invokeEdgeFunction('sales-settle-items-payment', {
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: {
            sale_id: saleId, item_allocations: allocations, method,
            paid_at: paidAt.toISOString(),
            note: (note.trim() ? '[Por item] ' + note.trim() : '[Por item] Baixa por peça — ' + customerName).slice(0, 500),
          },
        }));
      if (result.error) {
        toast.error('Processamento interrompido. ' + result.completed + ' venda(s) confirmada(s). Confira os recebimentos antes de tentar novamente.');
      } else {
        toast.success('Baixa registrada em ' + result.completed + ' venda(s)');
      }
      setSelected({});
      onOpenChange(false);
      onSettled?.();
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!submitLock.current) onOpenChange(next); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dar baixa por item — {customerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted/40 border p-3">
              <p className="text-[11px] text-muted-foreground">Itens selecionados</p>
              <p className="text-lg font-bold">{selectedCount}</p>
            </div>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-3">
              <p className="text-[11px] text-amber-700 dark:text-amber-400">Total</p>
              <p className="text-lg font-bold text-amber-900 dark:text-amber-300">{fmt(total)}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Itens em aberto</Label>
            <ScrollArea className="max-h-[280px] rounded-lg border">
              <div className="divide-y">
                {sales.map((s) => (
                  <div key={s.id} className="p-2.5">
                    <p className="text-[11px] font-medium text-muted-foreground px-1 pb-1.5">
                      Venda {new Date(s.created_at).toLocaleDateString('pt-BR')}
                      {s.due_date ? ` · venc ${new Date(s.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}
                    </p>
                    <div className="space-y-1.5">
                      {s.items.map((it) => {
                        const checked = it.id in selected;
                        return (
                          <div key={it.id} className="flex items-center gap-2 px-1">
                            <Checkbox
                              checked={checked}
                              disabled={it.balance <= 0}
                              onCheckedChange={(v) => toggleItem(it, !!v)}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate">
                                {it.qty > 1 ? `${it.qty}× ` : ''}{it.name}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Saldo: {fmt(it.balance)}{it.balance < it.line_total ? ` de ${fmt(it.line_total)}` : ''}
                              </p>
                            </div>
                            {checked ? (
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                max={it.balance}
                                value={selected[it.id]}
                                onChange={(e) => updateAmount(it, parseFloat(e.target.value) || 0)}
                                className="h-8 w-24 text-right text-xs shrink-0"
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground shrink-0 w-24 text-right">
                                {it.balance <= 0 ? 'Pago' : fmt(it.balance)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
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
                  <Calendar mode="single" selected={paidAt} onSelect={d => d && setPaidAt(d)} disabled={{ after: new Date() }} initialFocus className={cn('p-3 pointer-events-auto')} />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-settle-note">Observação (opcional)</Label>
            <Textarea
              id="item-settle-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={2}
              placeholder="Ex.: Cliente pagou estas 3 telas"
              className="w-full resize-y"
            />
            <p className="text-xs text-muted-foreground text-right">{note.length}/500</p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-11" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button className="flex-1 h-11" disabled={submitting || selectedCount === 0 || total <= 0} onClick={handleSubmit}>
              {submitting ? 'Registrando...' : 'Dar baixa nos itens selecionados'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
