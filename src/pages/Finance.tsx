import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { DollarSign, TrendingDown, TrendingUp, Plus, Wallet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { logger } from '@/lib/logger';
import PageHeader from '@/components/PageHeader';
import { startOfMonthUTCISO, startOfDaysAgoUTCISO } from '@/lib/dateBR';

const INCOME_CATEGORIES = [
  'Venda de produto', 'Ajuste de caixa', 'Reembolso', 'Outros recebimentos',
];
const EXPENSE_CATEGORIES = [
  'Compra de Estoque', 'Compra de mercadoria', 'Aluguel', 'Energia', 'Internet', 'Funcionários',
  'Transporte', 'Marketing', 'Impostos', 'Manutenção', 'Outros',
];
const PAYMENT_METHODS = [
  { value: 'pix', label: 'PIX' },
  { value: 'card', label: 'Cartão' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'other', label: 'Outro' },
];
const PM_LABEL: Record<string, string> = {
  pix: 'PIX', card: 'Cartão', cash: 'Dinheiro', transfer: 'Transferência', other: 'Outro',
};

export default function Finance() {
  const { profile, session } = useAuth();
  const isMobile = useIsMobile();
  const storeId = profile?.store_id;
  const [entries, setEntries] = useState<any[]>([]);
  const [summary, setSummary] = useState({ income: 0, expense: 0, balance: 0 });
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ entry_type: 'expense', category: '', amount: '', description: '', payment_method: '' });
  const [submitting, setSubmitting] = useState(false);
  const [period, setPeriod] = useState('month');

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const getDateRange = () => {
    if (period === 'week') return startOfDaysAgoUTCISO(7);
    return startOfMonthUTCISO();
  };

  const fetchData = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('cash_entries').select('*')
        .eq('store_id', storeId)
        .gte('occurred_at', getDateRange())
        .order('occurred_at', { ascending: false }).limit(50);
      if (error) {
        logger.error('Finance.fetchData', error);
        toast.error('Erro ao carregar lançamentos.');
      }
      const list = data || [];
      setEntries(list);
      const income = list.filter(e => e.entry_type === 'income').reduce((s, e) => s + Number(e.amount), 0);
      const expense = list.filter(e => e.entry_type === 'expense').reduce((s, e) => s + Number(e.amount), 0);
      setSummary({ income, expense, balance: income - expense });
    } finally {
      setLoading(false);
    }
  }, [storeId, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const currentCategories = form.entry_type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const handleSubmit = async () => {
    if (submitting) return;

    // Validation
    if (!session?.access_token) {
      toast.error('Sessão expirada. Faça login novamente.');
      return;
    }
    if (!storeId) {
      toast.error('Loja não identificada. Faça login novamente.');
      return;
    }
    if (!form.category.trim()) {
      toast.error('Selecione uma categoria.');
      return;
    }
    const amount = parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Informe um valor válido maior que zero.');
      return;
    }

    setSubmitting(true);
    logger.group('Finance.handleSubmit', { form, storeId });

    try {
      const { data: ledger, error: ledgerErr } = await supabase
        .from('cash_ledger').select('id')
        .eq('store_id', storeId).eq('is_default', true).single();

      if (ledgerErr || !ledger) {
        logger.error('Finance.handleSubmit', 'No default ledger', ledgerErr);
        toast.error('Caixa padrão não encontrado. Verifique as configurações.');
        return;
      }

      const { error } = await supabase.from('cash_entries').insert({
        store_id: storeId,
        ledger_id: ledger.id,
        entry_type: form.entry_type,
        category: form.category.trim(),
        amount,
        description: form.description.trim() || null,
        payment_method: form.payment_method || null,
        created_by: profile?.id || null,
      } as any);

      if (error) {
        logger.error('Finance.handleSubmit', error);
        if (error.message?.includes('row-level security')) {
          toast.error('Você não tem permissão para registrar lançamentos.');
        } else {
          toast.error(error.message || 'Erro ao registrar lançamento.');
        }
        return;
      }

      toast.success('Lançamento registrado com sucesso!');
      setDialogOpen(false);
      setForm({ entry_type: 'expense', category: '', amount: '', description: '', payment_method: '' });
      fetchData();
    } catch (err: any) {
      logger.error('Finance.handleSubmit', err);
      toast.error(err?.message || 'Erro inesperado ao registrar lançamento.');
    } finally {
      setSubmitting(false);
    }
  };

  const cards = [
    { title: 'Receitas', value: fmt(summary.income), icon: TrendingUp, color: 'text-emerald-500' },
    { title: 'Despesas', value: fmt(summary.expense), icon: TrendingDown, color: 'text-destructive' },
    { title: 'Saldo', value: fmt(summary.balance), icon: DollarSign, color: summary.balance >= 0 ? 'text-emerald-500' : 'text-destructive' },
  ];

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Financeiro"
        description="Controle de caixa, receitas e despesas"
        actions={
          <>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Semana</SelectItem>
                <SelectItem value="month">Mês</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => setDialogOpen(true)} variant="premium" size={isMobile ? 'sm' : 'default'} className="gap-2">
              <Plus className="h-4 w-4" /> {isMobile ? 'Novo' : 'Lançamento'}
            </Button>
          </>
        }
      />

      {/* Mobile quick actions */}
      <div className="flex gap-2 md:hidden">
        <Button variant="outline" className="flex-1 h-11" onClick={() => { setForm({ ...form, entry_type: 'income', category: '' }); setDialogOpen(true); }}>
          <TrendingUp className="h-4 w-4 mr-1 text-emerald-500" /> Entrada
        </Button>
        <Button variant="outline" className="flex-1 h-11" onClick={() => { setForm({ ...form, entry_type: 'expense', category: '' }); setDialogOpen(true); }}>
          <TrendingDown className="h-4 w-4 mr-1 text-destructive" /> Gasto
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3 md:gap-4">
        {cards.map(c => (
          <Card key={c.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-1 p-3 md:p-6">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
              <c.icon className={`h-4 w-4 ${c.color}`} />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              {loading ? <Skeleton className="h-8 w-24" /> : <div className="text-base md:text-2xl font-bold">{c.value}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Entries */}
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : isMobile ? (
        <div className="space-y-2">
          {entries.map(e => (
            <Card key={e.id}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={e.entry_type === 'income' ? 'default' : 'destructive'} className="text-xs">
                        {e.entry_type === 'income' ? 'Receita' : 'Despesa'}
                      </Badge>
                      <span className="text-sm font-medium">{e.category}</span>
                      {e.payment_method && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{PM_LABEL[e.payment_method] || e.payment_method}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">{e.description || 'Sem descrição'}</p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <p className={`text-sm font-semibold ${e.entry_type === 'income' ? 'text-emerald-600' : 'text-destructive'}`}>
                      {e.entry_type === 'income' ? '+' : '-'}{fmt(Number(e.amount))}
                    </p>
                    <p className="text-xs text-muted-foreground">{new Date(e.occurred_at).toLocaleDateString('pt-BR')}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {entries.length === 0 && (
            <div className="text-center py-12 text-muted-foreground"><Wallet className="mx-auto h-10 w-10 mb-2 opacity-50" />Nenhum lançamento</div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Categoria</TableHead><TableHead>Pagamento</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
              <TableBody>
                {entries.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm">{new Date(e.occurred_at).toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell><Badge variant={e.entry_type === 'income' ? 'default' : 'destructive'}>{e.entry_type === 'income' ? 'Receita' : 'Despesa'}</Badge></TableCell>
                    <TableCell className="text-sm">{e.category}</TableCell>
                    <TableCell className="text-sm">{e.payment_method ? <Badge variant="secondary" className="text-xs">{PM_LABEL[e.payment_method] || e.payment_method}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.description || '-'}</TableCell>
                    <TableCell className={`text-right text-sm font-medium ${e.entry_type === 'income' ? 'text-emerald-600' : 'text-destructive'}`}>{e.entry_type === 'income' ? '+' : '-'}{fmt(Number(e.amount))}</TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground"><Wallet className="mx-auto h-8 w-8 mb-2 opacity-50" />Nenhum lançamento</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={o => { if (!submitting) setDialogOpen(o); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Lançamento</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2"><Label>Tipo *</Label>
              <Select value={form.entry_type} onValueChange={v => setForm({ ...form, entry_type: v, category: '' })}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="income">Receita</SelectItem><SelectItem value="expense">Despesa</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Categoria *</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {currentCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Valor (R$) *</Label>
              <Input type="number" step="0.01" min="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="h-11" placeholder="0,00" />
            </div>
            <div className="space-y-2"><Label>Forma de pagamento</Label>
              <Select value={form.payment_method} onValueChange={v => setForm({ ...form, payment_method: v })}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Selecione (opcional)..." /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Descrição (opcional)</Label>
              <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Detalhes do lançamento..." />
            </div>
            <Button className="w-full h-11" onClick={handleSubmit} disabled={submitting || !form.category || !form.amount}>
              {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Registrando...</> : 'Registrar Lançamento'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
