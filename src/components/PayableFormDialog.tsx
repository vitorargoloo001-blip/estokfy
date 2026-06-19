import { useEffect, useState } from 'react';
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
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface PayableRow {
  id: string;
  description: string;
  category: string;
  supplier_id: string | null;
  amount: number;
  due_date: string;
  payment_method: string | null;
  notes: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: PayableRow | null;
  onSaved?: () => void;
}

const CATEGORIES = ['aluguel', 'energia', 'internet', 'fornecedor', 'funcionarios', 'transporte', 'marketing', 'impostos', 'manutencao', 'outros'];
const METHODS = ['pix', 'cash', 'credit_card', 'debit_card', 'transfer', 'boleto'];

export default function PayableFormDialog({ open, onOpenChange, initial, onSaved }: Props) {
  const { profile } = useAuth();
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('outros');
  const [supplierId, setSupplierId] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [dueDate, setDueDate] = useState<Date>(new Date());
  const [paymentMethod, setPaymentMethod] = useState<string>('pix');
  const [notes, setNotes] = useState('');
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !profile) return;
    supabase.from('suppliers').select('id, name').eq('store_id', profile.store_id).order('name').then(({ data }) => {
      setSuppliers(data || []);
    });
    if (initial) {
      setDescription(initial.description);
      setCategory(initial.category);
      setSupplierId(initial.supplier_id || '');
      setAmount(Number(initial.amount));
      setDueDate(new Date(initial.due_date + 'T00:00:00'));
      setPaymentMethod(initial.payment_method || 'pix');
      setNotes(initial.notes || '');
    } else {
      setDescription(''); setCategory('outros'); setSupplierId('');
      setAmount(0); setDueDate(new Date()); setPaymentMethod('pix'); setNotes('');
    }
  }, [open, profile, initial]);

  const handleSubmit = async () => {
    if (!profile) return;
    if (!description.trim()) { toast.error('Descrição obrigatória'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Valor inválido'); return; }

    setSubmitting(true);
    try {
      const payload = {
        store_id: profile.store_id,
        description: description.trim(),
        category,
        supplier_id: supplierId || null,
        amount,
        due_date: format(dueDate, 'yyyy-MM-dd'),
        payment_method: paymentMethod,
        notes: notes.trim() || null,
        created_by: profile.id,
      };
      const q = initial
        ? supabase.from('accounts_payable').update(payload).eq('id', initial.id)
        : supabase.from('accounts_payable').insert(payload);
      const { error } = await q;
      if (error) throw error;
      toast.success(initial ? 'Conta atualizada' : 'Conta cadastrada');
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao salvar conta');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{initial ? 'Editar conta' : 'Nova conta a pagar'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Descrição</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex: Aluguel da loja" className="h-11" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor</Label>
              <Input type="number" step="0.01" min="0" value={amount || ''} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className="h-11" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Vencimento</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('w-full h-11 justify-start text-left font-normal')}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(dueDate, 'dd/MM/yyyy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={dueDate} onSelect={d => d && setDueDate(d)} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Forma prevista</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fornecedor</Label>
              <Select value={supplierId || 'none'} onValueChange={v => setSupplierId(v === 'none' ? '' : v)}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— nenhum —</SelectItem>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1 h-11" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button className="flex-1 h-11" disabled={submitting} onClick={handleSubmit}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
