import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle, Loader2, CheckCircle2, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Module {
  module_key: string;
  is_active: boolean;
  activated_at: string | null;
  deactivation_scheduled_at: string | null;
  deactivation_requested_at: string | null;
}

interface ModuleToggleControlProps {
  storeId: string;
  module: Module;
  onToggle: () => void;
}

const MODULE_LABELS: Record<string, { label: string; description: string }> = {
  core: {
    label: 'Core (Sempre Ativo)',
    description: 'Sistema base - não pode ser desativado',
  },
  connect: {
    label: 'Estokfy Connect',
    description: 'Conciliação bancária automática',
  },
  loyalty: {
    label: 'Programa de Fidelidade',
    description: 'Sistema de pontos e recompensas',
  },
  pixel: {
    label: 'Estokfy Pixel',
    description: 'Rastreamento e análise avançada',
  },
  os: {
    label: 'Ordem de Serviço',
    description: 'Gestão de ordens de serviço / assistência',
  },
  analytics: {
    label: 'Analytics (em breve)',
    description: 'Relatórios avançados — reservado',
  },
  mobile: {
    label: 'Mobile (em breve)',
    description: 'Aplicativo móvel — reservado',
  },
};

export default function ModuleToggleControl({
  storeId,
  module,
  onToggle,
}: ModuleToggleControlProps) {
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleToggle = async () => {
    if (module.module_key === 'core') {
      alert('O módulo Core não pode ser desativado');
      return;
    }

    // Confirm only when DEACTIVATING (the destructive action). Activating is immediate.
    if (module.is_active && !showConfirm) {
      setShowConfirm(true);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('toggle_store_module', {
        p_store_id: storeId,
        p_module_key: module.module_key,
        p_is_active: !module.is_active,
      });

      if (error) {
        alert('Erro ao atualizar módulo: ' + error.message);
        return;
      }

      // Best-effort side effects (edge function). Never block a successful toggle if it
      // is unavailable (e.g. not deployed yet) — the module state already changed.
      try {
        await supabase.functions.invoke('manage-store-modules', {
          body: !module.is_active
            ? { action: 'send_notification', store_id: storeId, module_key: module.module_key, notification_type: 'activation' }
            : { action: 'revoke_tokens', store_id: storeId, module_key: module.module_key },
        });
      } catch (sideErr) {
        console.warn('[ModuleToggle] side-effect skipped:', sideErr);
      }

      setShowConfirm(false);
      onToggle();
    } catch (err) {
      console.error('Error toggling module:', err);
      alert('Erro ao atualizar módulo');
    } finally {
      setLoading(false);
    }
  };

  const info = MODULE_LABELS[module.module_key] || {
    label: module.module_key,
    description: '',
  };

  const isDeactivationScheduled = module.deactivation_scheduled_at
    ? new Date(module.deactivation_scheduled_at) > new Date()
    : false;

  return (
    <Card className={module.is_active ? '' : 'opacity-60'}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Checkbox
                checked={module.is_active}
                disabled={module.module_key === 'core' || loading}
                onCheckedChange={() => handleToggle()}
              />
              {info.label}
            </CardTitle>
            <CardDescription className="mt-1">{info.description}</CardDescription>
          </div>
          {module.is_active && (
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
          )}
        </div>
      </CardHeader>

      {(module.activated_at || isDeactivationScheduled) && (
        <CardContent className="pt-0 text-sm text-muted-foreground space-y-1">
          {module.activated_at && (
            <p>
              Ativado em: {new Date(module.activated_at).toLocaleDateString('pt-BR')}
            </p>
          )}
          {isDeactivationScheduled && (
            <p className="text-orange-600 font-medium">
              Desativação agendada para:{' '}
              {new Date(module.deactivation_scheduled_at!).toLocaleDateString('pt-BR')}
            </p>
          )}
        </CardContent>
      )}

      {showConfirm && (
        <CardContent className="pt-4 space-y-4 border-t">
          <div className="flex gap-3 p-3 bg-orange-50 rounded-lg border border-orange-200">
            <AlertCircle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-orange-900">
              <p className="font-medium">Tem certeza?</p>
              <p className="mt-1">
                Desativar este módulo bloqueará o acesso de todos os usuários em 5 segundos.
                Os dados serão mantidos.
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => setShowConfirm(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleToggle}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Desativando...
                </>
              ) : (
                'Desativar Módulo'
              )}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
