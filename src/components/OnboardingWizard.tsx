import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Store, Package, ShoppingCart, Settings, CheckCircle2, LayoutGrid } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { BUSINESS_TYPE_OPTIONS, BusinessType } from '@/lib/businessProfiles';
import { cn } from '@/lib/utils';

const SETUP_STEPS = [
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

const TOTAL_STEPS = SETUP_STEPS.length + 1; // +1 for business type step (index 0)

export default function OnboardingWizard() {
  const { needsOnboarding, dismissOnboarding, profile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [selectedBiz, setSelectedBiz] = useState<BusinessType>('retail');
  const [savingBiz, setSavingBiz] = useState(false);

  if (!needsOnboarding) return null;

  const isBusinessStep = step === 0;
  const setupStep = step - 1;
  const current = isBusinessStep ? null : SETUP_STEPS[setupStep];
  const isLast = step === TOTAL_STEPS - 1;

  const handleSelectBiz = async (type: BusinessType) => {
    setSelectedBiz(type);
    if (!profile?.store_id) return;
    setSavingBiz(true);
    await supabase.rpc('set_store_business_type' as any, {
      p_store_id: profile.store_id,
      p_business_type: type,
    });
    setSavingBiz(false);
  };

  const handleAction = () => {
    if (isBusinessStep) { setStep(1); return; }
    dismissOnboarding();
    navigate(current!.route);
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
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-8 bg-primary' : i < step ? 'w-4 bg-primary/40' : 'w-4 bg-muted'
                }`}
              />
            ))}
          </div>

          {isBusinessStep ? (
            /* Business type selection step */
            <div className="space-y-3">
              <div className="text-center space-y-2 py-2">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                  <LayoutGrid className="h-7 w-7 text-primary" />
                </div>
                <h3 className="font-semibold text-lg">Qual tipo de negócio você gerencia?</h3>
                <p className="text-sm text-muted-foreground">
                  O Estokfy vai adaptar menus e termos para o seu segmento.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                {BUSINESS_TYPE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleSelectBiz(opt.value)}
                    disabled={savingBiz}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all text-left',
                      selectedBiz === opt.value
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border hover:border-primary/30 hover:bg-muted/30'
                    )}
                  >
                    {selectedBiz === opt.value && (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                    <span className="truncate">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Regular setup step */
            <div className="text-center space-y-3 py-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                {current && <current.icon className="h-7 w-7 text-primary" />}
              </div>
              <h3 className="font-semibold text-lg">{current?.title}</h3>
              <p className="text-sm text-muted-foreground">{current?.description}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" className="flex-1" onClick={() => setStep(step - 1)}>
                Voltar
              </Button>
            )}
            {!isLast ? (
              <Button className="flex-1" onClick={handleAction} disabled={savingBiz}>
                {isBusinessStep ? 'Continuar' : 'Próximo'}
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
