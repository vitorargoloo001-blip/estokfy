import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Search, Plus, X, UserPlus, User } from 'lucide-react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { maskPhone, validatePhone } from '@/lib/masks';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface CustomerLite {
  id: string;
  name: string;
  phone: string | null;
  doc_id?: string | null;
  email?: string | null;
}

interface Props {
  storeId: string;
  value: string | null; // customer id ('' or null = avulso)
  onChange: (id: string | null, customer: CustomerLite | null) => void;
  /** Mostrar opção "Venda sem cliente / Avulso". Default true. */
  allowNone?: boolean;
  /** Permitir cadastrar novo cliente inline. Default true. */
  allowCreate?: boolean;
  placeholder?: string;
  className?: string;
  /** Buscar badges (dívida / fidelidade) para os resultados exibidos. Default true. */
  showBadges?: boolean;
}

interface ResultMeta {
  pending?: number;
  loyalty?: number;
}

export function CustomerSearch({
  storeId,
  value,
  onChange,
  allowNone = true,
  allowCreate = true,
  placeholder = 'Buscar cliente por nome, telefone ou CPF...',
  className,
  showBadges = true,
}: Props) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 200);
  const [results, setResults] = useState<CustomerLite[]>([]);
  const [meta, setMeta] = useState<Record<string, ResultMeta>>({});
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<CustomerLite | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Carregar cliente atualmente selecionado quando vier de fora
  useEffect(() => {
    if (!value) { setSelected(null); return; }
    if (selected?.id === value) return;
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, name, phone, doc_id, email')
        .eq('id', value)
        .maybeSingle();
      if (!cancel && data) setSelected(data as CustomerLite);
    })();
    return () => { cancel = true; };
  }, [value, selected?.id]);

  // Buscar resultados conforme usuário digita
  useEffect(() => {
    if (!storeId || !open) return;
    const term = debounced.trim();
    let cancel = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from('customers')
        .select('id, name, phone, doc_id, email')
        .eq('store_id', storeId)
        .order('name')
        .limit(15);
      if (term) {
        const safe = term.replace(/[%,]/g, ' ');
        q = q.or(
          `name.ilike.%${safe}%,phone.ilike.%${safe}%,doc_id.ilike.%${safe}%,email.ilike.%${safe}%`
        );
      }
      const { data } = await q;
      if (cancel) return;
      const list = (data || []) as CustomerLite[];
      setResults(list);
      setHighlight(0);
      setLoading(false);

      if (showBadges && list.length) {
        const ids = list.map(c => c.id);
        const [pendRes, loyRes] = await Promise.all([
          supabase
            .from('sales')
            .select('customer_id, amount_pending')
            .eq('store_id', storeId)
            .in('customer_id', ids)
            .in('payment_status', ['pending', 'partial'])
            .is('deleted_at', null),
          supabase
            .from('loyalty_credits')
            .select('customer_id, amount_available')
            .eq('store_id', storeId)
            .in('customer_id', ids)
            .eq('status', 'available'),
        ]);
        if (cancel) return;
        const next: Record<string, ResultMeta> = {};
        for (const row of (pendRes.data || []) as any[]) {
          const id = row.customer_id;
          next[id] = next[id] || {};
          next[id].pending = (next[id].pending || 0) + Number(row.amount_pending || 0);
        }
        for (const row of (loyRes.data || []) as any[]) {
          const id = row.customer_id;
          next[id] = next[id] || {};
          next[id].loyalty = (next[id].loyalty || 0) + Number(row.amount_available || 0);
        }
        setMeta(next);
      }
    })();
    return () => { cancel = true; };
  }, [debounced, storeId, open, showBadges]);

  // Fechar ao clicar fora
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const totalOptions =
    results.length + (allowNone ? 1 : 0) + (allowCreate ? 1 : 0);

  const pick = useCallback((c: CustomerLite | null) => {
    setSelected(c);
    onChange(c?.id ?? null, c);
    setOpen(false);
    setQuery('');
  }, [onChange]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') { setHighlight(h => Math.min(h + 1, totalOptions - 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setHighlight(h => Math.max(h - 1, 0)); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const noneOffset = allowNone ? 1 : 0;
      if (allowNone && highlight === 0) { pick(null); return; }
      const idx = highlight - noneOffset;
      if (idx >= 0 && idx < results.length) pick(results[idx]);
      else if (allowCreate && idx === results.length) {
        setForm(f => ({ ...f, name: query }));
        setCreateOpen(true);
      }
    } else if (e.key === 'Escape') { setOpen(false); }
  };

  const handleCreate = async () => {
    if (!storeId || saving) return;
    if (!form.name.trim()) { toast.error('Informe o nome'); return; }
    if (form.phone && !validatePhone(form.phone)) { toast.error('Telefone inválido'); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .insert({
          store_id: storeId,
          name: form.name.trim(),
          phone: form.phone.trim() || null,
        })
        .select('id, name, phone, doc_id, email')
        .single();
      if (error) throw error;
      pick(data as CustomerLite);
      setCreateOpen(false);
      setForm({ name: '', phone: '', notes: '' });
      toast.success('Cliente cadastrado!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao cadastrar');
    } finally {
      setSaving(false);
    }
  };

  // ========= RENDER =========
  return (
    <>
      <div ref={wrapRef} className={cn('relative', className)}>
        {selected ? (
          <div className="flex items-center gap-2 h-11 px-3 rounded-md border bg-background">
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{selected.name}</div>
              {selected.phone && (
                <div className="text-[11px] text-muted-foreground truncate">{selected.phone}</div>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => { pick(null); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
              title="Trocar cliente"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              className="h-11 pl-9"
              autoComplete="off"
            />
          </div>
        )}

        {open && !selected && (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-[320px] overflow-auto">
            {allowNone && (
              <button
                type="button"
                onMouseEnter={() => setHighlight(0)}
                onClick={() => pick(null)}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-b',
                  highlight === 0 ? 'bg-accent' : 'hover:bg-accent/60'
                )}
              >
                <User className="h-4 w-4 text-muted-foreground" />
                <span>Venda sem cliente (Avulso)</span>
              </button>
            )}

            {loading && (
              <div className="px-3 py-3 text-xs text-muted-foreground">Buscando...</div>
            )}

            {!loading && results.length === 0 && (
              <div className="px-3 py-3 text-xs text-muted-foreground">
                {query ? 'Nenhum cliente encontrado' : 'Digite para buscar'}
              </div>
            )}

            {results.map((c, i) => {
              const idx = i + (allowNone ? 1 : 0);
              const m = meta[c.id] || {};
              return (
                <button
                  key={c.id}
                  type="button"
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => pick(c)}
                  className={cn(
                    'w-full text-left px-3 py-2 flex items-start gap-3 border-b last:border-b-0',
                    highlight === idx ? 'bg-accent' : 'hover:bg-accent/60'
                  )}
                >
                  <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                    {c.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {[c.phone, c.doc_id].filter(Boolean).join(' · ') || '—'}
                    </div>
                    {(m.pending || m.loyalty) ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {m.pending && m.pending > 0 ? (
                          <Badge variant="outline" className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30 text-[10px] py-0 h-4">
                            Dívida R$ {m.pending.toFixed(2)}
                          </Badge>
                        ) : null}
                        {m.loyalty && m.loyalty > 0 ? (
                          <Badge variant="outline" className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 text-[10px] py-0 h-4">
                            Crédito R$ {m.loyalty.toFixed(2)}
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}

            {allowCreate && (
              <button
                type="button"
                onMouseEnter={() => setHighlight(results.length + (allowNone ? 1 : 0))}
                onClick={() => { setForm(f => ({ ...f, name: query })); setCreateOpen(true); }}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-t bg-muted/30 sticky bottom-0',
                  highlight === results.length + (allowNone ? 1 : 0) ? 'bg-accent' : 'hover:bg-accent/60'
                )}
              >
                <UserPlus className="h-4 w-4 text-primary" />
                <span className="font-medium text-primary">
                  + Cadastrar novo cliente{query ? `: "${query}"` : ''}
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                autoFocus
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="h-11"
                placeholder="Nome do cliente"
              />
            </div>
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: maskPhone(e.target.value) }))}
                className="h-11"
                placeholder="(11) 99999-9999"
              />
            </div>
            <div className="space-y-2">
              <Label>Observação (opcional)</Label>
              <Textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                placeholder="Anotações internas"
              />
            </div>
            <Button className="w-full h-11" disabled={saving} onClick={handleCreate}>
              {saving ? 'Salvando...' : 'Cadastrar e selecionar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default CustomerSearch;
