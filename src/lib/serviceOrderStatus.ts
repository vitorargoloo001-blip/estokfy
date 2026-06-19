export const SO_STATUS = [
  'aberta',
  'em_analise',
  'aguardando_aprovacao',
  'aguardando_peca',
  'em_reparo',
  'pronta_retirada',
  'entregue',
  'cancelada',
] as const;

export type ServiceOrderStatus = typeof SO_STATUS[number];

export const SO_STATUS_LABEL: Record<ServiceOrderStatus, string> = {
  aberta: 'Aberta',
  em_analise: 'Em análise',
  aguardando_aprovacao: 'Aguardando aprovação',
  aguardando_peca: 'Aguardando peça',
  em_reparo: 'Em reparo',
  pronta_retirada: 'Pronta para retirada',
  entregue: 'Entregue',
  cancelada: 'Cancelada',
};

export const SO_STATUS_COLOR: Record<ServiceOrderStatus, string> = {
  aberta: 'bg-blue-100 text-blue-700 border-blue-200',
  em_analise: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  aguardando_aprovacao: 'bg-amber-100 text-amber-700 border-amber-200',
  aguardando_peca: 'bg-orange-100 text-orange-700 border-orange-200',
  em_reparo: 'bg-purple-100 text-purple-700 border-purple-200',
  pronta_retirada: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  entregue: 'bg-green-100 text-green-800 border-green-200',
  cancelada: 'bg-red-100 text-red-700 border-red-200',
};

export const SO_PRIORITY_LABEL: Record<string, string> = {
  baixa: 'Baixa',
  normal: 'Normal',
  alta: 'Alta',
  urgente: 'Urgente',
};

export const SO_PAYMENT_METHODS = [
  { value: 'pix', label: 'PIX' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'card', label: 'Cartão' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'credit', label: 'A prazo' },
];

export function formatBRL(v: number | null | undefined) {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
