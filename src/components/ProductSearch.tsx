import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

interface ProductOption {
  id: string;
  sku?: string | null;
  name: string;
  brand: string | null;
  model: string | null;
  on_hand?: number;
  sale_price?: number;
}

interface Props {
  products: ProductOption[];
  onSelect: (product: ProductOption) => void;
  placeholder?: string;
  formatPrice?: (v: number) => string;
}

export default function ProductSearch({ products, onSelect, placeholder = 'Buscar por nome, marca ou modelo...', formatPrice }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = query
    ? products.filter(p => {
        const q = query.toLowerCase();
        return p.name.toLowerCase().includes(q) ||
          (p.brand || '').toLowerCase().includes(q) ||
          (p.model || '').toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q);
      }).slice(0, 10)
    : [];

  return (
    <div className="relative" ref={ref}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        data-global-search
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => query && setOpen(true)}
        className="pl-10"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-56 overflow-y-auto">
          {filtered.map(p => (
            <button
              key={p.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex justify-between gap-2"
              onClick={() => { onSelect(p); setQuery(''); setOpen(false); }}
            >
              <span className="truncate">
                {p.name}
                {p.brand && <span className="text-muted-foreground ml-1">({p.brand}{p.model ? ` ${p.model}` : ''})</span>}
              </span>
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                {p.on_hand !== undefined && `${p.on_hand} disp.`}
                {p.sale_price !== undefined && formatPrice && ` • ${formatPrice(p.sale_price)}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
