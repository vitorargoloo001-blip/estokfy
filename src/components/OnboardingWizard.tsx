import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Store, Package, ShoppingCart, Settings, CheckCircle2 } from 'lucide-react';

const STEPS = [
  {
    icon: Store,
    title: 'Dados da Loja',
    description: 'Complete as informações da sua loja: nome, telefone, endereço e logo.',
    route: '/configuracoes',
  },
  {
    icon: Package,
    title: 'Categorias e Produtos',
    description: 'Revise as categorias padrão e cadastre seus primeiros produtos.',
    route: '/produtos',
  },
  {
    icon: ShoppingCart,
    title: 'Primeira Venda',
    description: 'Com produtos cadastrados, registre sua primeira venda no sistema.',
    route: '/vendas/nova',
  },
  {
    icon: Settings,
    title: 'Configurações',
    description: 'Personalize métodos de pagamento, entregas e preferências do sistema.',
    route: '/configuracoes',
  },
];

export default function OnboardingWizard() {
  const { needsOnboarding, dismissOnboarding } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  if (!needsOnboarding) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const Icon = current.icon;

  const handleAction = () => {
    dismissOnboarding();
    navigate(current.route);
  };

  return (
    <Dialog open onOpenChange={() => dismissOnboarding()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            Sua loja está pronta!
          </DialogTitle>
          <DialogDescription>
            Configuramos tudo automaticamente. Siga os passos abaixo para começar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Step indicator */}
          <div className="flex gap-1.5 justify-center">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-8 bg-primary' : i < step ? 'w-4 bg-primary/40' : 'w-4 bg-muted'
                }`}
              />
            ))}
          </div>

          {/* Current step */}
          <div className="text-center space-y-3 py-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Icon className="h-7 w-7 text-primary" />
            </div>
            <h3 className="font-semibold text-lg">{current.title}</h3>
            <p className="text-sm text-muted-foreground">{current.description}</p>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" className="flex-1" onClick={() => setStep(step - 1)}>
                Voltar
              </Button>
            )}
            {!isLast ? (
              <Button className="flex-1" onClick={() => setStep(step + 1)}>
                Próximo
              </Button>
            ) : (
              <Button className="flex-1" onClick={handleAction}>
                Começar a usar
              </Button>
            )}
          </div>

          <button
            onClick={dismissOnboarding}
            className="w-full text-xs text-muted-foreground hover:underline"
          >
            Pular configuração
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
