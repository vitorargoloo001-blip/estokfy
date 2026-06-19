// Tradução amigável dos tipos de movimentação de estoque.
// IMPORTANTE: nunca alterar os nomes técnicos no banco — esta camada é
// apenas para apresentação (UI, PDF, exportações).

export type MovementCategory = 'in' | 'out' | 'adjustment' | 'loss';

export interface MovementMeta {
  label: string;
  category: MovementCategory;
}

const MAP: Record<string, MovementMeta> = {
  purchase_in: { label: 'Entrada de estoque', category: 'in' },
  sale_out: { label: 'Saída por venda', category: 'out' },
  adjustment: { label: 'Ajuste de estoque', category: 'adjustment' },
  return_in: { label: 'Entrada por devolução', category: 'in' },
  return_out: { label: 'Saída por troca/devolução', category: 'out' },
  manual_in: { label: 'Entrada manual', category: 'in' },
  manual_out: { label: 'Saída manual', category: 'out' },
  transfer_in: { label: 'Transferência recebida', category: 'in' },
  transfer_out: { label: 'Transferência enviada', category: 'out' },
  cancel_reversal: { label: 'Estorno de cancelamento', category: 'adjustment' },
  loss: { label: 'Perda/Avaria', category: 'loss' },
  inventory_fix: { label: 'Correção de inventário', category: 'adjustment' },
};

export function getMovementMeta(rawType: string): MovementMeta {
  if (!rawType) return { label: '—', category: 'adjustment' };
  const key = rawType.toLowerCase().trim();
  if (MAP[key]) return MAP[key];

  // Fallback heurístico para tipos não mapeados
  if (key.includes('loss') || key.includes('perda') || key.includes('avaria')) {
    return { label: 'Perda/Avaria', category: 'loss' };
  }
  if (key.includes('adjust') || key.includes('ajuste') || key.includes('inventory')) {
    return { label: 'Ajuste de estoque', category: 'adjustment' };
  }
  if (key.includes('return_in')) return { label: 'Entrada por devolução', category: 'in' };
  if (key.includes('return')) return { label: 'Saída por troca/devolução', category: 'out' };
  if (key.includes('transfer_in')) return { label: 'Transferência recebida', category: 'in' };
  if (key.includes('transfer')) return { label: 'Transferência enviada', category: 'out' };
  if (key.endsWith('_in') || key.includes('entrada') || key.includes('purchase')) {
    return { label: 'Entrada de estoque', category: 'in' };
  }
  if (key.endsWith('_out') || key.includes('saida') || key.includes('saída') || key.includes('sale')) {
    return { label: 'Saída por venda', category: 'out' };
  }

  // Último fallback: capitalizar
  const pretty = rawType.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { label: pretty, category: 'adjustment' };
}

export function translateMovementType(rawType: string): string {
  return getMovementMeta(rawType).label;
}

// Classes Tailwind para badges (usar em telas)
export function movementBadgeClass(category: MovementCategory): string {
  switch (category) {
    case 'in':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30';
    case 'out':
      return 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30';
    case 'adjustment':
      return 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30';
    case 'loss':
      return 'bg-rose-500/20 text-rose-700 dark:text-rose-400 border-rose-500/40';
  }
}
