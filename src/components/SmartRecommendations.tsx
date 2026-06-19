import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, TrendingDown, Package, Clock, ArrowRight, Sparkles, RefreshCw } from 'lucide-react';

interface Recommendation {
  priority: number;
  kind: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  link: string;
  entity_id: string | null;
  metric: number | null;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  margin_negative: TrendingDown,
  stock_out: Package,
  payable_overdue: AlertTriangle,
  stock_low: Package,
  receivable_overdue: AlertTriangle,
  margin_low: TrendingDown,
  product_idle: Clock,
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'border-l-4 border-l-destructive bg-destructive/5',
  warning: 'border-l-4 border-l-amber-500 bg-amber-500/5',
  info: 'border-l-4 border-l-blue-500 bg-blue-500/5',
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-destructive text-destructive-foreground',
  warning: 'bg-amber-500 text-white',
  info: 'bg-blue-500 text-white',
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Urgente',
  warning: 'Atenção',
  info: 'Sugestão',
};

export default function SmartRecommendations({ storeId }: { storeId: string }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('dashboard_intelligence', { p_limit: 8 });
    if (!error && data) setItems(data as Recommendation[]);
    setLoading(false);
  };

  useEffect(() => {
    if (storeId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Recomendações inteligentes
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={load} disabled={loading} className="h-8 w-8">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && items.length === 0 ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            🎉 Tudo em ordem! Nenhuma ação urgente no momento.
          </div>
        ) : (
          items.map((r, i) => {
            const Icon = ICON_MAP[r.kind] ?? AlertTriangle;
            return (
              <button
                key={`${r.kind}-${r.entity_id ?? i}`}
                onClick={() => navigate(r.link)}
                className={`group flex w-full items-start gap-3 rounded-md p-3 text-left transition-colors hover:bg-muted/60 ${SEVERITY_STYLES[r.severity]}`}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] ${SEVERITY_BADGE[r.severity]}`}>{SEVERITY_LABEL[r.severity]}</Badge>
                    <p className="truncate text-sm font-medium">{r.title}</p>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.description}</p>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
