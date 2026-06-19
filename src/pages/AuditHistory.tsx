import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Loader2, Clock, User, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Skeleton } from '@/components/ui/skeleton';

interface AuditLog {
  id: string;
  store_id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  before_json: any;
  after_json: any;
  actor_profile_id: string | null;
  created_at: string;
  profiles?: { full_name: string | null } | null;
}

const ENTITY_LABELS: Record<string, string> = {
  sale: 'Venda', product: 'Produto', customer: 'Cliente', delivery: 'Entrega',
  return: 'Devolução', stock: 'Estoque', payment: 'Pagamento', category: 'Categoria',
  settings: 'Configurações', profile: 'Usuário', store: 'Loja',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'Criação', update: 'Atualização', delete: 'Exclusão', archive: 'Arquivamento',
  restore: 'Restauração', status_change: 'Mudança de status',
};

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  update: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  delete: 'bg-destructive/10 text-destructive',
  archive: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

const PAGE_SIZE = 50;

export default function AuditHistory() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEntity, setFilterEntity] = useState('all');
  const [filterAction, setFilterAction] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [detailLog, setDetailLog] = useState<AuditLog | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!profile) return;
    setLoading(true);

    let query = supabase
      .from('audit_logs')
      .select('*, profiles!audit_logs_actor_profile_id_fkey(full_name)')
      .eq('store_id', profile.store_id)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (filterEntity !== 'all') query = query.eq('entity', filterEntity);
    if (filterAction !== 'all') query = query.eq('action', filterAction);

    const { data } = await query;
    const results = (data as any[]) || [];
    setLogs(results);
    setHasMore(results.length === PAGE_SIZE);
    setLoading(false);
  }, [profile, page, filterEntity, filterAction]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => { setPage(0); }, [filterEntity, filterAction]);

  const entityLabel = (e: string) => ENTITY_LABELS[e] || e;
  const actionLabel = (a: string) => ACTION_LABELS[a] || a;
  const actionColor = (a: string) => ACTION_COLORS[a] || 'bg-muted text-muted-foreground';

  const filteredLogs = search
    ? logs.filter(l =>
        entityLabel(l.entity).toLowerCase().includes(search.toLowerCase()) ||
        actionLabel(l.action).toLowerCase().includes(search.toLowerCase()) ||
        (l.profiles as any)?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        l.entity_id?.includes(search)
      )
    : logs;

  const formatDate = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  const renderJsonDiff = (before: any, after: any) => {
    if (!before && !after) return <p className="text-sm text-muted-foreground">Sem dados detalhados</p>;
    const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    return (
      <div className="space-y-2">
        {Array.from(allKeys).map(key => {
          const bv = before?.[key];
          const av = after?.[key];
          if (JSON.stringify(bv) === JSON.stringify(av) && bv !== undefined) return null;
          return (
            <div key={key} className="text-sm border rounded-md p-2">
              <p className="font-medium text-xs text-muted-foreground mb-1">{key}</p>
              <div className="flex items-center gap-2 flex-wrap">
                {bv !== undefined && (
                  <span className="bg-destructive/10 text-destructive px-2 py-0.5 rounded text-xs line-through">
                    {typeof bv === 'object' ? JSON.stringify(bv) : String(bv)}
                  </span>
                )}
                {bv !== undefined && av !== undefined && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                {av !== undefined && (
                  <span className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded text-xs">
                    {typeof av === 'object' ? JSON.stringify(av) : String(av)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const entities = ['all', ...new Set(logs.map(l => l.entity))];
  const actions = ['all', ...new Set(logs.map(l => l.action))];

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Histórico e Auditoria</h1>
        <p className="text-sm text-muted-foreground">Acompanhe todas as ações realizadas no sistema.</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar por módulo, ação, usuário..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 h-11" />
      </div>

      <div className="flex gap-2 flex-wrap">
        <Select value={filterEntity} onValueChange={setFilterEntity}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Módulo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os módulos</SelectItem>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Ação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as ações</SelectItem>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
      ) : isMobile ? (
        <div className="space-y-2">
          {filteredLogs.map(l => (
            <Card key={l.id} className="overflow-hidden" onClick={() => setDetailLog(l)}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={`text-xs ${actionColor(l.action)}`}>{actionLabel(l.action)}</Badge>
                      <Badge variant="outline" className="text-xs">{entityLabel(l.entity)}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <User className="h-3 w-3" />
                      <span>{(l.profiles as any)?.full_name || 'Sistema'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                    <Clock className="h-3 w-3" />
                    {formatDate(l.created_at)}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {filteredLogs.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Clock className="mx-auto h-10 w-10 mb-2 opacity-50" />
              <p>Nenhum registro encontrado</p>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Módulo</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map(l => (
                  <TableRow key={l.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailLog(l)}>
                    <TableCell className="text-xs whitespace-nowrap">{formatDate(l.created_at)}</TableCell>
                    <TableCell className="text-sm">{(l.profiles as any)?.full_name || 'Sistema'}</TableCell>
                    <TableCell><Badge className={`text-xs ${actionColor(l.action)}`}>{actionLabel(l.action)}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{entityLabel(l.entity)}</Badge></TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{l.entity_id?.slice(0, 8) || '-'}</TableCell>
                    <TableCell><Button variant="ghost" size="sm" className="text-xs">Detalhes</Button></TableCell>
                  </TableRow>
                ))}
                {filteredLogs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      <Clock className="mx-auto h-8 w-8 mb-2 opacity-50" />Nenhum registro encontrado
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{filteredLogs.length} registros • Página {page + 1}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={!hasMore}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detailLog} onOpenChange={() => setDetailLog(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do Registro</DialogTitle>
            <DialogDescription>Informações completas da ação registrada.</DialogDescription>
          </DialogHeader>
          {detailLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Data/Hora</p>
                  <p className="font-medium">{new Date(detailLog.created_at).toLocaleString('pt-BR')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Usuário</p>
                  <p className="font-medium">{(detailLog.profiles as any)?.full_name || 'Sistema'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Ação</p>
                  <Badge className={actionColor(detailLog.action)}>{actionLabel(detailLog.action)}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Módulo</p>
                  <Badge variant="outline">{entityLabel(detailLog.entity)}</Badge>
                </div>
                {detailLog.entity_id && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">ID do registro</p>
                    <p className="font-mono text-xs">{detailLog.entity_id}</p>
                  </div>
                )}
              </div>

              {(detailLog.before_json || detailLog.after_json) && (
                <>
                  <div className="border-t pt-3">
                    <p className="text-sm font-semibold mb-2">Alterações</p>
                    {renderJsonDiff(detailLog.before_json, detailLog.after_json)}
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
