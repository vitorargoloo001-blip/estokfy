import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from '@/components/ui/accordion';
import {
  Rocket, Package, ShoppingCart, Wallet, DollarSign, BarChart3,
  RotateCcw, Printer, UserCog, Trophy, Play, Presentation as PresentationIcon,
  HelpCircle, ArrowRight, Sparkles,
} from 'lucide-react';
import PageHeader from '@/components/PageHeader';

interface Topic {
  icon: any;
  title: string;
  desc: string;
  steps: string[];
  cta?: { label: string; to: string };
}

const TOPICS: Topic[] = [
  {
    icon: Rocket, title: 'Primeiros passos',
    desc: 'Configure sua loja em minutos: dados, equipe e primeiras categorias.',
    steps: [
      'Preencha os dados da loja em Configurações.',
      'Cadastre as principais categorias (ex.: Películas, Capas, Carregadores).',
      'Convide a equipe na seção Funcionários e defina as funções.',
      'Cadastre os primeiros produtos e ajuste o estoque inicial.',
    ],
    cta: { label: 'Ir para Configurações', to: '/configuracoes' },
  },
  {
    icon: Package, title: 'Cadastro de produtos',
    desc: 'Cadastre um por um, em massa ou importando uma planilha. Suporte a código de barras.',
    steps: [
      'Em Produtos, clique em “Novo produto” e preencha nome, preço e estoque.',
      'Use o botão “Cadastro em massa” para criar vários de uma vez.',
      'Importe planilhas Excel/CSV com colunas Nome, Preço, Estoque e Código de barras.',
      'Escaneie um código de barras com um leitor USB para preencher o campo automaticamente.',
    ],
    cta: { label: 'Abrir Produtos', to: '/produtos' },
  },
  {
    icon: ShoppingCart, title: 'Como vender',
    desc: 'Fluxo de balcão rápido: produto → cliente → pagamento → comprovante.',
    steps: [
      'Clique em Nova Venda e busque o produto digitando ou usando o scanner.',
      'Ao escanear o mesmo item de novo, a quantidade aumenta automaticamente.',
      'Selecione o cliente no campo de busca inteligente (basta digitar 2 letras).',
      'Aplique desconto se necessário, escolha a forma de pagamento e finalize.',
    ],
    cta: { label: 'Iniciar uma venda', to: '/vendas/nova' },
  },
  {
    icon: Wallet, title: 'Vendas a prazo',
    desc: 'Registre vendas pendentes, controle vencimentos e receba depois.',
    steps: [
      'Na finalização da venda escolha “A prazo / Pendente” e defina a data de vencimento.',
      'A venda aparece em Contas a Receber com status Pendente.',
      'Quando o cliente pagar, registre o recebimento (parcial ou total).',
      'O sistema atualiza o caixa e o status automaticamente.',
    ],
    cta: { label: 'Ver Contas a Receber', to: '/contas-a-receber' },
  },
  {
    icon: DollarSign, title: 'Financeiro',
    desc: 'Acompanhe entradas, saídas, despesas e contas a pagar em um único lugar.',
    steps: [
      'Veja o resumo do caixa, entradas e saídas em Financeiro.',
      'Cadastre despesas e contas a pagar com data de vencimento.',
      'Marque como pago para abater do caixa automaticamente.',
      'Use os filtros de período para fechar o dia, a semana ou o mês.',
    ],
    cta: { label: 'Abrir Financeiro', to: '/financeiro' },
  },
  {
    icon: BarChart3, title: 'Relatórios',
    desc: 'Vendas do dia, formas de pagamento, mais vendidos, lucro e desempenho da loja.',
    steps: [
      'Escolha o período em Relatórios e veja os KPIs do negócio.',
      'Filtre por vendedor para ver o desempenho de cada funcionário.',
      'Exporte relatórios em PDF para enviar ao contador ou ao sócio.',
      'Use Compras para acompanhar entradas de estoque e custos.',
    ],
    cta: { label: 'Abrir Relatórios', to: '/relatorios' },
  },
  {
    icon: RotateCcw, title: 'Trocas e devoluções',
    desc: 'Registre devoluções, devolva ao estoque e ajuste o financeiro com auditoria.',
    steps: [
      'Em Trocas, selecione a venda e os itens devolvidos.',
      'Escolha se o item volta para o estoque ou não.',
      'Defina o reembolso (dinheiro, crédito de fidelidade, etc.).',
      'Tudo fica registrado no Histórico para auditoria.',
    ],
    cta: { label: 'Abrir Trocas', to: '/trocas' },
  },
  {
    icon: Printer, title: 'Scanner e impressão',
    desc: 'Use leitor de código de barras e imprima comprovante em impressora térmica/Tanca.',
    steps: [
      'Conecte o leitor USB — ele funciona como teclado, sem instalação.',
      'Em Configurações → Impressão ative o cupom térmico (58mm ou 80mm).',
      'Ative “Imprimir automaticamente após venda” se quiser impressão imediata.',
      'Reimprima qualquer venda pelo botão Comprovante na tela de detalhes.',
    ],
    cta: { label: 'Ajustar impressão', to: '/configuracoes' },
  },
  {
    icon: UserCog, title: 'Funcionários',
    desc: 'Cada funcionário tem login próprio. Você acompanha quem vendeu o quê.',
    steps: [
      'Em Funcionários, clique em “Convidar” e informe nome, e-mail e função.',
      'O funcionário recebe um e-mail para criar a senha.',
      'O sistema registra todas as vendas, trocas e ações no nome de cada usuário.',
      'No Dashboard veja o ranking de desempenho da equipe.',
    ],
    cta: { label: 'Abrir Funcionários', to: '/funcionarios' },
  },
  {
    icon: Trophy, title: 'Fidelidade',
    desc: 'Premie clientes recorrentes com crédito automático e acompanhe o ranking.',
    steps: [
      'Em Fidelidade veja o histórico de créditos gerados por cliente.',
      'Use o crédito disponível como abatimento na próxima venda.',
      'Acompanhe o ranking dos melhores clientes.',
    ],
    cta: { label: 'Abrir Fidelidade', to: '/fidelidade' },
  },
];

const FAQ: { q: string; a: string }[] = [
  { q: 'Como faço para escanear um código de barras?',
    a: 'Conecte um leitor USB e foque na tela de Nova Venda, Produtos ou Estoque. O leitor digita o código sozinho — não precisa instalar nada.' },
  { q: 'O sistema funciona em celular?',
    a: 'Sim. Todas as telas são responsivas e otimizadas para uso de balcão em tablet ou celular.' },
  { q: 'Como imprimir o comprovante em impressora Tanca?',
    a: 'Ative a impressão térmica em Configurações → Impressão, escolha 58mm ou 80mm, e use o botão Comprovante na venda. A impressão usa o driver do Windows.' },
  { q: 'Posso ter mais de um funcionário usando ao mesmo tempo?',
    a: 'Sim. Cada funcionário tem login próprio. Tudo o que ele faz fica registrado no nome dele para auditoria.' },
  { q: 'Como recebo uma venda a prazo?',
    a: 'Vá em Contas a Receber, abra a venda e clique em Receber. Pode ser pagamento total ou parcial.' },
  { q: 'Como importar produtos de uma planilha?',
    a: 'Em Produtos clique em “Cadastro em massa” → “Importar Excel/CSV”. Baixe o modelo, preencha e envie.' },
  { q: 'Como devolvo um produto?',
    a: 'Em Trocas, selecione a venda original, marque os itens, escolha se volta ao estoque e defina o reembolso.' },
  { q: 'Onde vejo o lucro da loja?',
    a: 'Em Relatórios você vê o lucro bruto por período, por produto e por vendedor.' },
];

export default function Help() {
  const navigate = useNavigate();
  const { setShowGuide } = useAuth();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ajuda & Treinamento"
        description="Aprenda a usar o Estokfy em poucos minutos. Tutoriais, tour guiado e respostas rápidas."
        badge={<HelpCircle className="h-5 w-5 text-primary" />}
      />

      {/* Hero actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-6 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/20">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <PresentationIcon className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold">Apresentação completa</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Slides visuais cobrindo todas as funcionalidades do Estokfy. Ideal para treinar a equipe.
              </p>
              <Button onClick={() => navigate('/apresentacao')}>
                <Play className="h-4 w-4 mr-2" />
                Iniciar apresentação
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-accent/30 via-accent/10 to-transparent">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-foreground/10 text-foreground flex items-center justify-center shrink-0">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold">Tour guiado</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Um passo a passo dentro do próprio sistema, destacando cada botão e função.
              </p>
              <Button variant="outline" onClick={() => { navigate('/'); setTimeout(() => setShowGuide(true), 200); }}>
                <Play className="h-4 w-4 mr-2" />
                Iniciar tour guiado
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Topics grid */}
      <div>
        <h2 className="text-lg font-bold mb-3">Tópicos</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {TOPICS.map((t) => {
            const Icon = t.icon;
            return (
              <Card key={t.title} className="p-5 hover:shadow-md transition-shadow flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-bold leading-tight">{t.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-3">{t.desc}</p>
                <ol className="space-y-1.5 text-sm flex-1 list-decimal list-inside marker:text-primary marker:font-bold">
                  {t.steps.map((s, i) => (
                    <li key={i} className="text-foreground/80">{s}</li>
                  ))}
                </ol>
                {t.cta && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3 self-start text-primary hover:text-primary"
                    onClick={() => navigate(t.cta!.to)}
                  >
                    {t.cta.label} <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* FAQ */}
      <Card className="p-6">
        <h2 className="text-lg font-bold mb-1">Perguntas frequentes</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Respostas rápidas para as dúvidas mais comuns dos usuários.
        </p>
        <Accordion type="single" collapsible className="w-full">
          {FAQ.map((f, i) => (
            <AccordionItem key={i} value={`item-${i}`}>
              <AccordionTrigger className="text-left text-sm font-semibold">{f.q}</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Card>

      <div className="text-center text-xs text-muted-foreground pt-4">
        Não encontrou o que procurava? Fale com o suporte da sua loja ou abra o chat de IA disponível no canto da tela.
      </div>
    </div>
  );
}
