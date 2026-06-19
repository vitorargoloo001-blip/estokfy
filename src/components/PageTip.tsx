import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { X, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

const PAGE_TIPS: Record<string, { title: string; tip: string }> = {
  '/': {
    title: 'Central Operacional',
    tip: 'Este é seu painel principal. Veja vendas do dia, estoque baixo e entregas pendentes de um só lugar.',
  },
  '/produtos': {
    title: 'Produtos',
    tip: 'Aqui você cadastra seus produtos. Clique em "Novo Produto" para começar. Use o filtro de estoque para encontrar itens zerados.',
  },
  '/categorias': {
    title: 'Categorias',
    tip: 'Organize seus produtos em categorias. Já criamos 12 categorias padrão. Você pode editar ou criar novas.',
  },
  '/estoque': {
    title: 'Estoque',
    tip: 'Controle as entradas e saídas do estoque. Clique em "Movimentar" para registrar compras, ajustes ou perdas.',
  },
  '/vendas': {
    title: 'Vendas',
    tip: 'Veja o histórico de vendas. Use os filtros por data, status ou cliente para encontrar vendas específicas.',
  },
  '/vendas/nova': {
    title: 'Nova Venda',
    tip: 'Selecione os produtos, escolha a forma de pagamento e finalize. O estoque é deduzido automaticamente.',
  },
  '/clientes': {
    title: 'Clientes',
    tip: 'Cadastre seus clientes para rastrear vendas. Use nome, telefone ou CPF para encontrar rapidamente.',
  },
  '/entregas': {
    title: 'Entregas',
    tip: 'Acompanhe o status das entregas. Atualize para "Entregue" quando o cliente receber o produto.',
  },
  '/trocas': {
    title: 'Trocas e Devoluções',
    tip: 'Registre trocas vinculadas a uma venda. Escolha se o produto volta ao estoque e o valor do reembolso.',
  },
  '/financeiro': {
    title: 'Financeiro',
    tip: 'Controle seu caixa. As vendas entram automaticamente. Registre despesas clicando em "Nova entrada".',
  },
  '/relatorios': {
    title: 'Relatórios',
    tip: 'Gere relatórios por período. Veja receita, lucro, estoque baixo e devoluções. Exporte em CSV ou PDF.',
  },
  '/configuracoes': {
    title: 'Configurações',
    tip: 'Personalize o sistema: dados da loja, usuários, pagamentos, entregas, notificações e muito mais.',
  },
  '/historico': {
    title: 'Histórico de Auditoria',
    tip: 'Veja todas as ações realizadas no sistema: vendas, ajustes de estoque, alterações de dados.',
  },
};

const DISMISSED_KEY = 'page_tips_dismissed';

function getDismissed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function PageTip() {
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState<Record<string, boolean>>(getDismissed);
  const [visible, setVisible] = useState(false);

  // Normalize path for matching
  const normalizedPath = '/' + pathname.replace(/^\/+/, '');
  const tip = PAGE_TIPS[normalizedPath];

  useEffect(() => {
    if (!profile?.show_onboarding_guide || !tip || dismissed[normalizedPath]) {
      setVisible(false);
      return;
    }
    // Small delay so it doesn't flash during navigation
    const t = setTimeout(() => setVisible(true), 400);
    return () => clearTimeout(t);
  }, [normalizedPath, profile?.show_onboarding_guide, tip, dismissed]);

  if (!visible || !tip) return null;

  const handleDismiss = () => {
    const updated = { ...dismissed, [normalizedPath]: true };
    setDismissed(updated);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(updated));
    setVisible(false);
  };

  return (
    <div className={cn(
      'mb-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 animate-in fade-in slide-in-from-top-2 duration-300'
    )}>
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Lightbulb className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{tip.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{tip.tip}</p>
      </div>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label="Fechar dica"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
