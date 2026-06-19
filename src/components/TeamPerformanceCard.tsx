import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trophy } from 'lucide-react';
import { startOfMonthUTCISO, startOfTodayUTCISO } from '@/lib/dateBR';

interface Row {
  profile_id: string;
  full_name: string;
  role: string;
  sales_count: number;
  sales_revenue: number;
  avg_ticket: number;
  returns_count: number;
}

const fmtBRL = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function TeamPerformanceCard() {
  const [period, setPeriod] = useState<'today' | 'month'>('month');
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    (async () => {
      const start = period === 'today' ? startOfTodayUTCISO() : startOfMonthUTCISO();
      const end = new Date(Date.now() + 86400000).toISOString();
      const { data } = await supabase.rpc('get_employee_performance', { p_start: start, p_end: end });
      setRows((data || []).filter((r: Row) => r.sales_count > 0).slice(0, 5));
    })();
  }, [period]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-primary" />Desempenho da equipe
        </CardTitle>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as any)}>
          <TabsList className="h-7">
            <TabsTrigger value="today" className="text-xs h-6">Hoje</TabsTrigger>
            <TabsTrigger value="month" className="text-xs h-6">Mês</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem vendas no período.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={r.profile_id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50">
                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.full_name || '—'}</p>
                  <p className="text-xs text-muted-foreground">{r.sales_count} vendas · ticket {fmtBRL(r.avg_ticket)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{fmtBRL(r.sales_revenue)}</p>
                  {r.returns_count > 0 && <p className="text-xs text-destructive">{r.returns_count} devol.</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
