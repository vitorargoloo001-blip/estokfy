/**
 * Sistema de reconhecimento de intenções do Estok IA.
 * Detecta comandos digitados pelo usuário e mapeia para ações de navegação.
 * Operação 100% local — não consome créditos de IA.
 */

export type IntentId =
  | 'registrar_venda'
  | 'registrar_troca'
  | 'registrar_entrada_estoque'
  | 'ver_estoque_baixo'
  | 'ver_relatorio_diario'
  | 'ver_relatorio_mensal'
  | 'registrar_despesa'
  | 'registrar_entrega'
  | 'fechar_caixa'
  | 'ver_vendas'
  | 'ver_produtos'
  | 'ver_clientes';

export interface Intent {
  id: IntentId;
  label: string;
  /** Mensagem exibida antes de navegar */
  feedback: string;
  /** Rota para navegar */
  route: string;
  /** Query params opcionais (ex.: filtro estoque baixo) */
  search?: string;
  /** Padrões que disparam essa intenção */
  patterns: RegExp[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export const INTENTS: Intent[] = [
  {
    id: 'registrar_venda',
    label: 'Registrar venda',
    feedback: 'Abrindo nova venda...',
    route: '/vendas/nova',
    patterns: [
      /\b(registrar|nova|criar|fazer|abrir)\s+(uma\s+)?venda\b/,
      /\bvender\s+(produto|item)?/,
      /\bnova\s+venda\b/,
    ],
  },
  {
    id: 'registrar_troca',
    label: 'Registrar troca',
    feedback: 'Abrindo trocas...',
    route: '/trocas',
    patterns: [
      /\b(registrar|nova|criar|fazer|abrir)\s+(uma\s+)?(troca|devolu[cç][aã]o)\b/,
      /\bdevolver\s+(produto|item)?/,
    ],
  },
  {
    id: 'registrar_entrada_estoque',
    label: 'Nova entrada de estoque',
    feedback: 'Abrindo estoque para nova entrada...',
    route: '/estoque',
    search: '?action=entrada',
    patterns: [
      /\b(registrar|nova|adicionar|dar)\s+entrada\b/,
      /\b(entrada|compra)\s+de\s+(produto|estoque|mercadoria)\b/,
      /\brepor\s+estoque\b/,
    ],
  },
  {
    id: 'ver_estoque_baixo',
    label: 'Ver estoque baixo',
    feedback: 'Abrindo produtos com estoque baixo...',
    route: '/estoque',
    search: '?filter=low',
    patterns: [
      /\bestoque\s+(baixo|cr[ií]tico|m[ií]nimo)\b/,
      /\bprodutos?\s+(acabando|em\s+falta|faltando)\b/,
      /\bfalta\s+(de\s+)?produto/,
      /\bquais?\s+produtos?\s+est[aã]o\s+acabando/,
    ],
  },
  {
    id: 'ver_relatorio_diario',
    label: 'Relatório de hoje',
    feedback: 'Abrindo relatório diário...',
    route: '/relatorios',
    search: '?periodo=hoje',
    patterns: [
      /\brelat[oó]rio\s+(di[aá]rio|de\s+hoje|do\s+dia)\b/,
      /\bver\s+relat[oó]rio\s+de\s+hoje\b/,
      /\bresumo\s+(do\s+)?dia\b/,
    ],
  },
  {
    id: 'ver_relatorio_mensal',
    label: 'Relatório mensal',
    feedback: 'Abrindo relatório mensal...',
    route: '/relatorios',
    search: '?periodo=mes',
    patterns: [
      /\brelat[oó]rio\s+(mensal|do\s+m[eê]s)\b/,
      /\bresumo\s+(do\s+)?m[eê]s\b/,
    ],
  },
  {
    id: 'registrar_despesa',
    label: 'Adicionar despesa',
    feedback: 'Abrindo financeiro para nova despesa...',
    route: '/financeiro',
    search: '?action=despesa',
    patterns: [
      /\b(adicionar|registrar|lan[cç]ar|nova|criar)\s+(uma\s+)?(despesa|gasto|sa[ií]da)\b/,
      /\bgasto\s+(novo|do\s+dia)?/,
      /\bpagamento\s+de\s+(conta|fornecedor)/,
    ],
  },
  {
    id: 'registrar_entrega',
    label: 'Nova entrega',
    feedback: 'Abrindo entregas...',
    route: '/entregas',
    patterns: [
      /\b(registrar|nova|criar|abrir)\s+(uma\s+)?entrega\b/,
      /\bentregas?\s+pendentes?\b/,
      /\bver\s+entregas?\b/,
    ],
  },
  {
    id: 'fechar_caixa',
    label: 'Fechar caixa',
    feedback: 'Abrindo financeiro para fechamento...',
    route: '/financeiro',
    search: '?action=fechamento',
    patterns: [
      /\bfechar?\s+(o\s+)?caixa\b/,
      /\bfechamento\s+(do\s+)?(caixa|dia)\b/,
    ],
  },
  {
    id: 'ver_vendas',
    label: 'Ver vendas',
    feedback: 'Abrindo lista de vendas...',
    route: '/vendas',
    patterns: [/\b(ver|listar|abrir|mostrar)\s+(as\s+)?vendas\b/],
  },
  {
    id: 'ver_produtos',
    label: 'Ver produtos',
    feedback: 'Abrindo produtos...',
    route: '/produtos',
    patterns: [/\b(ver|listar|abrir|mostrar)\s+(os\s+)?produtos\b/],
  },
  {
    id: 'ver_clientes',
    label: 'Ver clientes',
    feedback: 'Abrindo clientes...',
    route: '/clientes',
    patterns: [/\b(ver|listar|abrir|mostrar)\s+(os\s+)?clientes\b/],
  },
];

const INTENT_BY_ID = new Map(INTENTS.map(i => [i.id, i]));

export function getIntent(id: IntentId): Intent | undefined {
  return INTENT_BY_ID.get(id);
}

/**
 * Detecta intenção a partir de uma mensagem do usuário.
 * Retorna `null` se nenhum padrão bater (caso em que a mensagem deve ir para a IA).
 */
export function detectIntent(message: string): Intent | null {
  const text = norm(message);
  if (!text) return null;
  for (const intent of INTENTS) {
    if (intent.patterns.some(p => p.test(text))) return intent;
  }
  return null;
}
