import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Package, Tags, ShoppingCart, Users, Truck, DollarSign, BarChart3,
  Sparkles, ChevronRight, ChevronLeft, X, BookOpen
} from 'lucide-react';

const GUIDE_STEPS = [
  {
    icon: Package,
    title: 'Cadastro de Produtos',
    description: 'Cadastre os produtos da sua loja com nome, preço de custo, preço de venda e estoque inicial. Use SKU e código de barras para organizar melhor.',
    tip: 'Dica: Comece cadastrando seus 10 produtos mais vendidos.',
    route: '/produtos',
    color: 'text-blue-500 bg-blue-500/10',
  },
  {
    icon: Tags,
    title: 'Cadastro de Categorias',
    description: 'Organize seus produtos em categorias como Telas, Baterias, Conectores. Já criamos 12 categorias padrão para você!',
    tip: 'Dica: Você pode editar, criar ou desativar categorias a qualquer momento.',
    route: '/categorias',
    color: 'text-purple-500 bg-purple-500/10',
  },
  {
    icon: ShoppingCart,
    title: 'Registro de Venda',
    description: 'Para registrar uma venda, selecione os produtos, defina a forma de pagamento e finalize. O estoque é atualizado automaticamente.',
    tip: 'Dica: Use o atalho Ctrl+N para abrir rapidamente uma nova venda.',
    route: '/vendas/nova',
    color: 'text-green-500 bg-green-500/10',
  },
  {
    icon: Users,
    title: 'Cadastro de Clientes',
    description: 'Cadastre seus clientes com nome, telefone e documento. Isso permite rastrear vendas e gerar relatórios por cliente.',
    tip: 'Dica: O cadastro de cliente é opcional na venda, mas ajuda no controle.',
    route: '/clientes',
    color: 'text-amber-500 bg-amber-500/10',
  },
  {
    icon: Truck,
    title: 'Registro de Entregas',
    description: 'Acompanhe as entregas das suas vendas. Defina o método (Correios, motoboy, retirada) e atualize o status em tempo real.',
    tip: 'Dica: Use códigos de rastreio para manter o cliente informado.',
    route: '/entregas',
    color: 'text-cyan-500 bg-cyan-500/10',
  },
  {
    icon: DollarSign,
    title: 'Controle Financeiro',
    description: 'Registre entradas e saídas do caixa. Vendas são lançadas automaticamente. Adicione despesas como aluguel, energia e compras.',
    tip: 'Dica: Mantenha o financeiro atualizado diariamente para relatórios precisos.',
    route: '/financeiro',
    color: 'text-emerald-500 bg-emerald-500/10',
  },
  {
    icon: BarChart3,
    title: 'Relatórios',
    description: 'Visualize relatórios de vendas, lucro, estoque baixo e devoluções. Exporte em CSV ou PDF para análise detalhada.',
    tip: 'Dica: Use filtros de data para comparar períodos diferentes.',
    route: '/relatorios',
    color: 'text-indigo-500 bg-indigo-500/10',
  },
];

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
    scale: 0.96,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
    scale: 0.96,
  }),
};

const welcomeVariants = {
  hidden: { opacity: 0, scale: 0.9, y: 20 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } },
  exit: { opacity: 0, scale: 0.95, y: -10, transition: { duration: 0.25 } },
};

const iconVariants = {
  hidden: { scale: 0, rotate: -30 },
  visible: { scale: 1, rotate: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 20, delay: 0.15 } },
};

const tipVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { delay: 0.2, duration: 0.3 } },
};

interface InteractiveGuideProps {
  open: boolean;
  onClose: () => void;
}

export default function InteractiveGuide({ open, onClose }: InteractiveGuideProps) {
  const navigate = useNavigate();
  const [showWelcome, setShowWelcome] = useState(true);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);

  const handleStart = () => setShowWelcome(false);

  const handleSkip = useCallback(() => {
    setShowWelcome(true);
    setStep(0);
    setDirection(1);
    onClose();
  }, [onClose]);

  const handleGoTo = () => {
    const route = GUIDE_STEPS[step].route;
    handleSkip();
    navigate(route);
  };

  const goNext = () => {
    setDirection(1);
    setStep(s => s + 1);
  };

  const goPrev = () => {
    setDirection(-1);
    setStep(s => s - 1);
  };

  const current = GUIDE_STEPS[step];
  const Icon = current?.icon;
  const isLast = step === GUIDE_STEPS.length - 1;
  const progress = ((step + 1) / GUIDE_STEPS.length) * 100;

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={() => handleSkip()}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          {showWelcome ? (
            <motion.div
              key="welcome"
              variants={welcomeVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="p-6 space-y-5 text-center"
            >
              <motion.div
                variants={iconVariants}
                initial="hidden"
                animate="visible"
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"
              >
                <Sparkles className="h-8 w-8 text-primary" />
              </motion.div>
              <DialogHeader className="space-y-2">
                <DialogTitle className="text-xl">Bem-vindo ao Estokfy 👋</DialogTitle>
                <DialogDescription className="text-sm">
                  Vamos te mostrar como usar o sistema em poucos passos. É rápido e fácil!
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2 pt-2">
                <Button size="lg" className="w-full" onClick={handleStart}>
                  <BookOpen className="h-4 w-4 mr-2" />
                  Começar guia
                </Button>
                <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={handleSkip}>
                  Pular por agora
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Este guia aparecerá toda vez que você entrar. Para desativar, vá em Configurações → Preferências.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key={`step-${step}`}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="flex flex-col"
            >
              {/* Header with progress */}
              <div className="px-6 pt-5 pb-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Passo {step + 1} de {GUIDE_STEPS.length}
                  </span>
                  <button onClick={handleSkip} className="text-muted-foreground hover:text-foreground transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <motion.div
                  key={`progress-${step}`}
                  initial={false}
                  animate={{ width: '100%' }}
                >
                  <Progress value={progress} className="h-1.5 transition-all duration-500" />
                </motion.div>
              </div>

              {/* Step content */}
              <div className="px-6 py-4 space-y-4">
                <div className="flex items-start gap-4">
                  <motion.div
                    variants={iconVariants}
                    initial="hidden"
                    animate="visible"
                    className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${current.color}`}
                  >
                    <Icon className="h-6 w-6" />
                  </motion.div>
                  <div className="space-y-1.5 min-w-0">
                    <h3 className="font-semibold text-lg leading-tight">{current.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{current.description}</p>
                  </div>
                </div>

                {current.tip && (
                  <motion.div
                    variants={tipVariants}
                    initial="hidden"
                    animate="visible"
                    className="bg-muted/50 rounded-lg p-3 border"
                  >
                    <p className="text-xs text-muted-foreground">💡 {current.tip}</p>
                  </motion.div>
                )}
              </div>

              {/* Actions */}
              <div className="px-6 pb-5 space-y-3">
                <div className="flex gap-2">
                  {step > 0 && (
                    <Button variant="outline" className="flex-1" onClick={goPrev}>
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Voltar
                    </Button>
                  )}
                  {!isLast ? (
                    <Button className="flex-1" onClick={goNext}>
                      Próximo
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  ) : (
                    <Button className="flex-1" onClick={handleSkip}>
                      Concluir guia ✓
                    </Button>
                  )}
                </div>
                <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={handleGoTo}>
                  Ir para {current.title} →
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
