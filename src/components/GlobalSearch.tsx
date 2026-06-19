import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Package, Users, ShoppingCart, Wallet, DollarSign, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Hit { id: string; label: string; sub?: string; route: string; }
interface Results {
  products: Hit[]; customers: Hit[]; sales: Hit[]; payables: Hit[]; receivables: Hit[];
}

const fmtBRL = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Results>({
    products: [], customers: [], sales: [], payables: [], receivables: [],
  });
  const debouncedQ = useDebouncedValue(q, 300);
  const { profile } = useAuth();
  const navigate = useNavigate();
  const storeId = profile?.store_id;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!storeId || !debouncedQ.trim() || debouncedQ.trim().length < 2) {
      setResults({ products: [], customers: [], sales: [], payables: [], receivables: [] });
      return;
    }
    const safe = debouncedQ.trim().replace(/[%,]/g, '');
    setLoading(true);

    Promise.all([
      supabase.from('products')
        .select('id,name,on_hand')
        .eq('store_id', storeId).eq('is_active', true)
        .or(`name.ilike.%${safe}%,brand.ilike.%${safe}%,model.ilike.%${safe}%,barcode.ilike.%${safe}%`)
        .limit(6),
      supabase.from('customers').select('id,name,phone')
        .eq('store_id', storeId)
        .or(`name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`)
        .limit(6),
      supabase.from('sales').select('id,net_total,created_at,customers(name)')
        .eq('store_id', storeId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(5),
      supabase.from('accounts_payable').select('id,description,amount,status')
        .eq('store_id', storeId)
        .ilike('description', `%${safe}%`).limit(5),
      supabase.from('sales').select('id,amount_pending,customers(name)')
        .eq('store_id', storeId).is('deleted_at', null).in('payment_status', ['pending', 'partial'])
        .limit(5),
    ]).then(([p, c, s, ap, rec]) => {
      setResults({
        products: (p.data || []).map((r: any) => ({
          id: r.id, label: r.name, sub: `${r.on_hand} un`, route: '/produtos',
        })),
        customers: (c.data || []).map((r: any) => ({
          id: r.id, label: r.name, sub: r.phone || '', route: '/clientes',
        })),
        sales: (s.data || []).filter((r: any) =>
          (r.customers?.name || '').toLowerCase().includes(safe.toLowerCase()) ||
          r.id.startsWith(safe)
        ).map((r: any) => ({
          id: r.id, label: `Venda • ${r.customers?.name || 'Sem cliente'}`,
          sub: `${fmtBRL(r.net_total)} • ${new Date(r.created_at).toLocaleDateString('pt-BR')}`,
          route: '/vendas',
        })),
        payables: (ap.data || []).map((r: any) => ({
          id: r.id, label: r.description, sub: `${fmtBRL(r.amount)} • ${r.status}`, route: '/contas-a-pagar',
        })),
        receivables: (rec.data || []).filter((r: any) =>
          (r.customers?.name || '').toLowerCase().includes(safe.toLowerCase())
        ).map((r: any) => ({
          id: r.id, label: r.customers?.name || 'Cliente',
          sub: `Pendente: ${fmtBRL(r.amount_pending)}`, route: '/contas-a-receber',
        })),
      });
      setLoading(false);
    });
  }, [debouncedQ, storeId]);

  const go = (route: string) => { navigate(route); setOpen(false); setQ(''); };

  const totalHits =
    results.products.length + results.customers.length + results.sales.length +
    results.payables.length + results.receivables.length;

  return (
    <>
      <Button
        variant="outline" size="sm" onClick={() => setOpen(true)}
        className="hidden md:flex h-9 w-64 justify-start gap-2 text-xs text-muted-foreground"
      >
        <Search className="h-3.5 w-3.5" />
        Buscar...
        <kbd className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </Button>
      <Button
        variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)}
        aria-label="Buscar"
      >
        <Search className="h-5 w-5" />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Buscar produto, cliente, venda, conta..." value={q} onValueChange={setQ} />
        <CommandList>
          {loading && (
            <div className="flex items-center justify-center p-4 text-xs text-muted-foreground gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
            </div>
          )}
          {!loading && q.length >= 2 && totalHits === 0 && (
            <CommandEmpty>Nada encontrado.</CommandEmpty>
          )}
          {results.products.length > 0 && (
            <CommandGroup heading="Produtos">
              {results.products.map(h => (
                <CommandItem key={`p-${h.id}`} onSelect={() => go(h.route)}>
                  <Package className="mr-2 h-4 w-4" />
                  <span className="flex-1">{h.label}</span>
                  <span className="text-xs text-muted-foreground">{h.sub}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.customers.length > 0 && (
            <CommandGroup heading="Clientes">
              {results.customers.map(h => (
                <CommandItem key={`c-${h.id}`} onSelect={() => go(h.route)}>
                  <Users className="mr-2 h-4 w-4" />
                  <span className="flex-1">{h.label}</span>
                  <span className="text-xs text-muted-foreground">{h.sub}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.sales.length > 0 && (
            <CommandGroup heading="Vendas">
              {results.sales.map(h => (
                <CommandItem key={`s-${h.id}`} onSelect={() => go(h.route)}>
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  <span className="flex-1">{h.label}</span>
                  <span className="text-xs text-muted-foreground">{h.sub}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.receivables.length > 0 && (
            <CommandGroup heading="Contas a receber">
              {results.receivables.map(h => (
                <CommandItem key={`r-${h.id}`} onSelect={() => go(h.route)}>
                  <Wallet className="mr-2 h-4 w-4" />
                  <span className="flex-1">{h.label}</span>
                  <span className="text-xs text-muted-foreground">{h.sub}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.payables.length > 0 && (
            <CommandGroup heading="Contas a pagar">
              {results.payables.map(h => (
                <CommandItem key={`a-${h.id}`} onSelect={() => go(h.route)}>
                  <DollarSign className="mr-2 h-4 w-4" />
                  <span className="flex-1">{h.label}</span>
                  <span className="text-xs text-muted-foreground">{h.sub}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {q.length < 2 && (
            <CommandGroup heading="Atalhos">
              <CommandItem onSelect={() => go('/vendas/nova')}>Nova venda</CommandItem>
              <CommandItem onSelect={() => go('/produtos')}>Cadastrar produto</CommandItem>
              <CommandItem onSelect={() => go('/contas-a-pagar')}>Contas a pagar</CommandItem>
              <CommandItem onSelect={() => go('/contas-a-receber')}>Contas a receber</CommandItem>
              <CommandItem onSelect={() => go('/relatorios')}>Relatórios</CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
