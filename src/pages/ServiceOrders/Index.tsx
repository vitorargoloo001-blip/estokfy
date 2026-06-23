import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plus, Wrench, Clock, Package, CheckCircle2, DollarSign, Search } from 'lucide-react';
import { StatusBadge } from '@/components/service-orders/StatusBadge';
import { SO_STATUS, SO_STATUS_LABEL, ServiceOrderStatus, formatBRL } from '@/lib/serviceOrderStatus';
import { useBusinessLabels } from '@/hooks/useBusinessLabels';

interface SO {
  id: string;
  os_number: number;
  customer_name: string;
  customer_phone: string | null;
  device: string;
  brand: string | null;
  model: string | null;
  status: ServiceOrderStatus;
  total_amount: number;
  pending_amount: number;
  entry_date: string;
  estimated_delivery: string | null;
  priority: string;
}

export default function ServiceOrdersIndex() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { labels } = useBusinessLabels();
  const [rows, setRows] = useState<SO[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | ServiceOrderStatus>('all');

  useEffect(() => {
    if (!profile?.store_id) return;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from('service_orders')
        .select('id, os_number, customer_name, customer_phone, device, brand, model, status, total_amount, pending_amount, entry_date, estimated_delivery, priority')
        .eq('store_id', profile.store_id)
        .order('entry_date', { ascending: false })
        .limit(500);
      setRows((data || []) as SO[]);
      setLoading(false);
    })();
  }, [profile?.store_id]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(r => {
      if (tab !== 'all' && r.status !== tab) return false;
      if (!term) return true;
      return [String(r.os_number), r.customer_name, r.customer_phone, r.device, r.brand, r.model]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(term));
    });
  }, [rows, q, tab]);

  const stats = useMemo(() => {
    const open = rows.filter(r => !['entregue', 'cancelada'].includes(r.status));
    const todayStr = new Date().toISOString().slice(0, 10);
    return {
      abertas: rows.filter(r => r.status === 'aberta').length,
      andamento: rows.filter(r => ['em_analise', 'em_reparo'].includes(r.status)).length,
      aguardandoPeca: rows.filter(r => r.status === 'aguardando_peca').length,
      finalizadasHoje: rows.filter(r => r.status === 'entregue' && r.entry_date.slice(0, 10) === todayStr).length,
      valorPrevisto: open.reduce((s, r) => s + Number(r.total_amount || 0), 0),
      valorRecebido: rows.reduce((s, r) => s + (Number(r.total_amount || 0) - Number(r.pending_amount || 0)), 0),
    };
  }, [rows]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Wrench className="h-6 w-6 text-primary" /> {labels.work_order}s</h1>
          <p className="text-sm text-muted-foreground">Gerencie atendimentos, serviços e entregas</p>
        </div>
        <Button onClick={() => navigate('/os/nova')}><Plus className="h-4 w-4 mr-2" />Nova {labels.work_order}</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Wrench} label="Abertas" value={stats.abertas} />
        <StatCard icon={Clock} label="Em andamento" value={stats.andamento} />
        <StatCard icon={Package} label={`Aguard. ${labels.product}`} value={stats.aguardandoPeca} />
        <StatCard icon={CheckCircle2} label="Finalizadas hoje" value={stats.finalizadasHoje} />
        <StatCard icon={DollarSign} label="Previsto" value={formatBRL(stats.valorPrevisto)} />
        <StatCard icon={DollarSign} label="Recebido" value={formatBRL(stats.valorRecebido)} />
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder={`Buscar por nº, cliente, ${labels.equipment.toLowerCase()}...`} value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as any)}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="all">Todas ({rows.length})</TabsTrigger>
          {SO_STATUS.map(s => (
            <TabsTrigger key={s} value={s}>{SO_STATUS_LABEL[s]} ({rows.filter(r => r.status === s).length})</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">OS</th>
                    <th className="text-left px-4 py-2">Cliente</th>
                    <th className="text-left px-4 py-2">{labels.equipment}</th>
                    <th className="text-left px-4 py-2">Entrada</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-right px-4 py-2">Total</th>
                    <th className="text-right px-4 py-2">Pendente</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Carregando...</td></tr>}
                  {!loading && filtered.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Nenhuma OS encontrada</td></tr>}
                  {filtered.map(r => (
                    <tr key={r.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/os/${r.id}`)}>
                      <td className="px-4 py-2 font-mono font-semibold">#{String(r.os_number).padStart(5, '0')}</td>
                      <td className="px-4 py-2">
                        <div className="font-medium">{r.customer_name}</div>
                        <div className="text-xs text-muted-foreground">{r.customer_phone}</div>
                      </td>
                      <td className="px-4 py-2">{[r.device, r.brand, r.model].filter(Boolean).join(' ')}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{new Date(r.entry_date).toLocaleDateString('pt-BR')}</td>
                      <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-2 text-right">{formatBRL(r.total_amount)}</td>
                      <td className={`px-4 py-2 text-right ${r.pending_amount > 0 ? 'text-destructive font-semibold' : ''}`}>{formatBRL(r.pending_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-primary opacity-60" />
      </div>
    </Card>
  );
}
