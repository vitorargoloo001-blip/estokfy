import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Plus, Plug } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import ModuleToggleControl from '@/components/ModuleToggleControl';

interface Store {
  id: string;
  business_name: string;
  plan: string;
  is_active: boolean;
}

interface Module {
  module_key: string;
  is_active: boolean;
  activated_at: string | null;
  deactivation_scheduled_at: string | null;
  deactivation_requested_at: string | null;
}

interface StoreWithModules extends Store {
  modules: Module[];
}

const MODULE_ORDER = ['core', 'connect', 'os', 'loyalty', 'pixel', 'analytics', 'mobile'];

export default function SuperAdminModuleLicensing() {
  const [stores, setStores] = useState<StoreWithModules[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);

  const loadStores = async () => {
    setLoading(true);
    setError(null);
    try {
      // Get all stores via RPC (master user only)
      const { data: storesData, error: storesError } = await supabase.rpc(
        'get_all_stores_for_admin'
      );

      if (storesError) throw storesError;

      // For each store, get its modules
      const storesWithModules = await Promise.all(
        (storesData || []).map(async (store: Store) => {
          const { data: modulesData } = await supabase.rpc('get_store_modules', {
            p_store_id: store.id,
          });

          return {
            ...store,
            modules: (modulesData || []).sort(
              (a: Module, b: Module) =>
                MODULE_ORDER.indexOf(a.module_key) - MODULE_ORDER.indexOf(b.module_key)
            ),
          };
        })
      );

      setStores(storesWithModules);
      if (storesWithModules.length > 0 && !selectedStore) {
        setSelectedStore(storesWithModules[0].id);
      }
    } catch (err: any) {
      console.error('Error loading stores:', err);
      setError(err?.message || 'Erro ao carregar lojas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStores();
  }, []);

  const currentStore = stores.find((s) => s.id === selectedStore);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 py-12 text-center">
        <p className="text-sm text-destructive break-words max-w-md mx-auto">{error}</p>
        <Button variant="outline" onClick={loadStores}>Tentar novamente</Button>
      </div>
    );
  }

  if (stores.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">Nenhuma loja encontrada.</div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Plug className="h-8 w-8" />
          Licenças de Módulos
        </h1>
        <p className="text-muted-foreground mt-2">
          Gerenciar ativação/desativação de módulos por loja
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Store List */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Lojas</h3>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {stores.map((store) => (
              <Button
                key={store.id}
                variant={selectedStore === store.id ? 'default' : 'outline'}
                className="w-full justify-start text-left h-auto p-3"
                onClick={() => setSelectedStore(store.id)}
              >
                <div>
                  <div className="font-medium text-sm">{store.business_name}</div>
                  <div className="text-xs text-muted-foreground">{store.plan}</div>
                </div>
              </Button>
            ))}
          </div>
        </div>

        {/* Store Modules */}
        <div className="lg:col-span-3">
          {currentStore ? (
            <Card>
              <CardHeader>
                <CardTitle>{currentStore.business_name}</CardTitle>
                <CardDescription>
                  Plano: <span className="font-semibold">{currentStore.plan}</span> •{' '}
                  Status:{' '}
                  <span className={currentStore.is_active ? 'text-green-600' : 'text-red-600'}>
                    {currentStore.is_active ? 'Ativa' : 'Bloqueada'}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="modules" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="modules">Módulos</TabsTrigger>
                    <TabsTrigger value="audit">Auditoria</TabsTrigger>
                  </TabsList>

                  <TabsContent value="modules" className="space-y-3 mt-4">
                    {currentStore.modules.map((module) => (
                      <ModuleToggleControl
                        key={module.module_key}
                        storeId={currentStore.id}
                        module={module}
                        onToggle={loadStores}
                      />
                    ))}
                  </TabsContent>

                  <TabsContent value="audit" className="mt-4">
                    <StoreAuditLog storeId={currentStore.id} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-8 text-center text-muted-foreground">
                Nenhuma loja selecionada
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function StoreAuditLog({ storeId }: { storeId: string }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadLogs = async () => {
      try {
        const { data } = await supabase.rpc('list_module_audit', {
          p_store_id: storeId,
          p_limit: 50,
        });
        setLogs(data || []);
      } catch (err) {
        console.error('Error loading audit logs:', err);
      } finally {
        setLoading(false);
      }
    };

    loadLogs();
  }, [storeId]);

  if (loading) {
    return <div className="text-center py-4 text-muted-foreground">Carregando...</div>;
  }

  if (logs.length === 0) {
    return <div className="text-center py-4 text-muted-foreground">Sem eventos</div>;
  }

  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <div key={log.id} className="text-sm border-l-2 border-muted pl-3 py-2">
          <div className="font-medium">
            {log.module_key.toUpperCase()} • {log.action}
          </div>
          <div className="text-xs text-muted-foreground">
            {log.admin_name} • {new Date(log.created_at).toLocaleDateString('pt-BR')}
          </div>
        </div>
      ))}
    </div>
  );
}
