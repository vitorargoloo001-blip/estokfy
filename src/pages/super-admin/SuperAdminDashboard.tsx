import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Store, Users, ShieldCheck, AlertTriangle, Clock, Ban } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

interface Stats {
  total: number;
  active: number;
  suspended: number;
  blocked: number;
  trial: number;
  overdue: number;
  totalUsers: number;
}

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, suspended: 0, blocked: 0, trial: 0, overdue: 0, totalUsers: 0 });
  const [recentStores, setRecentStores] = useState<any[]>([]);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    const { data: stores } = await supabase.from('stores').select('id, name, subscription_status, access_enabled, created_at');
    const { count: userCount } = await supabase.from('profiles').select('id', { count: 'exact', head: true });

    if (stores) {
      setStats({
        total: stores.length,
        active: stores.filter(s => s.subscription_status === 'active' && s.access_enabled).length,
        suspended: stores.filter(s => s.subscription_status === 'suspended').length,
        blocked: stores.filter(s => !s.access_enabled).length,
        trial: stores.filter(s => s.subscription_status === 'trial').length,
        overdue: stores.filter(s => s.subscription_status === 'overdue').length,
        totalUsers: userCount || 0,
      });
      setRecentStores(stores.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5));
    }
  };

  const statCards = [
    { label: 'Total de Lojas', value: stats.total, icon: Store, color: 'text-primary' },
    { label: 'Ativas', value: stats.active, icon: ShieldCheck, color: 'text-green-600' },
    { label: 'Suspensas', value: stats.suspended, icon: AlertTriangle, color: 'text-yellow-600' },
    { label: 'Bloqueadas', value: stats.blocked, icon: Ban, color: 'text-destructive' },
    { label: 'Trial', value: stats.trial, icon: Clock, color: 'text-blue-500' },
    { label: 'Usuários Totais', value: stats.totalUsers, icon: Users, color: 'text-purple-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold">Painel Super Admin</h1>
        <Button asChild size="sm"><Link to="/super-admin/stores">Ver todas as lojas</Link></Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map(c => (
          <Card key={c.label}>
            <CardContent className="pt-4 pb-3 text-center">
              <c.icon className={`mx-auto h-6 w-6 mb-1 ${c.color}`} />
              <p className="text-2xl font-bold">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Lojas Recentes</CardTitle></CardHeader>
        <CardContent>
          {recentStores.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma loja encontrada.</p>
          ) : (
            <div className="space-y-3">
              {recentStores.map(s => (
                <div key={s.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3 last:border-0">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={s.access_enabled ? 'default' : 'destructive'}>
                      {s.access_enabled ? 'Ativo' : 'Bloqueado'}
                    </Badge>
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/super-admin/stores/${s.id}`}>Detalhes</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
