import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileText, Plus, MoreVertical, Download, Paperclip, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useConnectExport } from '@/hooks/useConnectExport';
import { logger } from '@/lib/logger';
import FiscalDocumentFormDialog from '@/components/FiscalDocumentFormDialog';
import {
  listFiscalDocuments, getFiscalSummary, setFiscalDocumentStatus, getFiscalFileUrl,
  resolveFiscalError, FISCAL_STATUS_LABEL, FISCAL_TYPE_LABEL, FISCAL_DIRECTION_LABEL,
  type FiscalDocumentRow, type FiscalSummary, type FiscalStatus,
} from '@/lib/fiscalApi';

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const STATUS_VARIANT: Record<FiscalStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  sent_to_accountant: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  declared: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  cancelled: 'bg-muted text-muted-foreground',
};

const fmtMoney = (v: number) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Fiscal() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const { exportToPDF, exportToCSV } = useConnectExport();

  const canManage = ['owner', 'admin', 'manager', 'finance'].includes(profile?.role ?? '');

  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number | 'all'>(now.getMonth() + 1);
  const [status, setStatus] = useState<FiscalStatus | 'all'>('all');
  const [docType, setDocType] = useState<string>('all');
  const [direction, setDirection] = useState<string>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);

  const [rows, setRows] = useState<FiscalDocumentRow[]>([]);
  const [summary, setSummary] = useState<FiscalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FiscalDocumentRow | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const docs = await listFiscalDocuments({
        storeId: profile.store_id,
        status,
        documentType: docType as never,
        direction: direction as never,
        competenceYear: year,
        competenceMonth: month === 'all' ? null : month,
        search: debouncedSearch,
      });
      setRows(docs);

      if (canManage) {
        setSummary(await getFiscalSummary(profile.store_id, year, month === 'all' ? null : month));
      }
    } catch (e) {
      logger.error('Falha ao carregar notas fiscais', e);
      toast.error(resolveFiscalError(e));
    } finally {
      setLoading(false);
    }
  }, [profile, status, docType, direction, year, month, debouncedSearch, canManage]);

  useEffect(() => { load(); }, [load]);

  const changeStatus = async (row: FiscalDocumentRow, next: FiscalStatus) => {
    try {
      await setFiscalDocumentStatus(row.id, next);
      toast.success(`Nota marcada como "${FISCAL_STATUS_LABEL[next]}"`);
      load();
    } catch (e) {
      toast.error(resolveFiscalError(e));
    }
  };

  const openAttachment = async (path: string) => {
    const url = await getFiscalFileUrl(path);
    if (url) window.open(url, '_blank', 'noopener');
    else toast.error('Não foi possível abrir o anexo.');
  };

  const exportRows = useMemo(
    () =>
      rows.map(r => [
        r.invoice_number,
        r.series || '-',
        FISCAL_TYPE_LABEL[r.document_type],
        FISCAL_DIRECTION_LABEL[r.direction],
        format(new Date(r.issue_date + 'T00:00:00'), 'dd/MM/yyyy'),
        `${String(r.competence_month).padStart(2, '0')}/${r.competence_year}`,
        r.counterpart_name || '-',
        r.counterpart_doc || '-',
        fmtMoney(Number(r.total_amount)),
        FISCAL_STATUS_LABEL[r.fiscal_status],
      ]),
    [rows],
  );

  const doExport = (kind: 'pdf' | 'csv') => {
    if (!rows.length) { toast.error('Nada para exportar com os filtros atuais.'); return; }
    const periodo = month === 'all' ? String(year) : `${MONTHS[(month as number) - 1]}/${year}`;
    const payload = {
      title: `Fiscal — ${periodo}`,
      filename: `estokfy_fiscal_${year}${month === 'all' ? '' : String(month).padStart(2, '0')}`,
      columns: ['Número', 'Série', 'Tipo', 'Operação', 'Emissão', 'Competência', 'Cliente/Fornecedor', 'CPF/CNPJ', 'Valor', 'Status'],
      data: exportRows,
    };
    if (kind === 'pdf') exportToPDF(payload); else exportToCSV(payload);
  };

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 3 + i);

  const cards = summary
    ? [
        { label: 'Notas no período', value: String(summary.period_count), accent: '' },
        { label: 'Pendentes de declaração', value: String(summary.pending_count), accent: summary.pending_count > 0 ? 'text-amber-600 dark:text-amber-400' : '' },
        { label: 'Valor pendente', value: fmtMoney(summary.pending_amount), accent: '' },
        { label: 'Enviadas ao contador', value: String(summary.sent_count), accent: '' },
        { label: 'Declaradas', value: String(summary.declared_count), accent: '' },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileText className="h-6 w-6" /> Notas Fiscais
          </h1>
          <p className="text-sm text-muted-foreground">
            Controle do que precisa ser declarado. O Estokfy organiza e lembra — não emite nem declara.
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-11">
                  <Download className="mr-2 h-4 w-4" /> Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => doExport('pdf')}>PDF</DropdownMenuItem>
                <DropdownMenuItem onClick={() => doExport('csv')}>Excel / CSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button className="h-11" onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Lançar Nota Fiscal
            </Button>
          </div>
        )}
      </div>

      {canManage && summary && summary.overdue_count > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400" />
          <span>
            {summary.overdue_count} nota(s) pendente(s) há mais de {summary.alert_days} dias.
            O prazo de alerta é configurável pela loja.
          </span>
        </div>
      )}

      {canManage && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {(loading && !summary ? Array.from({ length: 5 }) : cards).map((c, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                {loading && !summary ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">{(c as typeof cards[0]).label}</p>
                    <p className={`text-xl font-semibold mt-1 ${(c as typeof cards[0]).accent}`}>
                      {(c as typeof cards[0]).value}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
        <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
          <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(month)} onValueChange={v => setMonth(v === 'all' ? 'all' : Number(v))}>
          <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os meses</SelectItem>
            {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={v => setStatus(v as FiscalStatus | 'all')}>
          <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {(Object.keys(FISCAL_STATUS_LABEL) as FiscalStatus[]).map(s => (
              <SelectItem key={s} value={s}>{FISCAL_STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {Object.entries(FISCAL_TYPE_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={direction} onValueChange={setDirection}>
          <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Entrada e saída</SelectItem>
            {Object.entries(FISCAL_DIRECTION_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input className="h-11" placeholder="Número, nome ou chave" value={search}
          onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <FileText className="h-10 w-10 mb-3 opacity-50" />
          <p>Nenhuma nota fiscal nesse filtro.</p>
        </div>
      ) : isMobile ? (
        <div className="space-y-2">
          {rows.map(r => (
            <Card key={r.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {FISCAL_TYPE_LABEL[r.document_type]} {r.invoice_number}
                      {r.series ? `/${r.series}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.counterpart_name || '—'} · {format(new Date(r.issue_date + 'T00:00:00'), 'dd/MM/yyyy')}
                    </p>
                  </div>
                  <Badge className={STATUS_VARIANT[r.fiscal_status]} variant="secondary">
                    {FISCAL_STATUS_LABEL[r.fiscal_status]}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{fmtMoney(Number(r.total_amount))}</span>
                  {canManage && <RowActions row={r} onEdit={() => { setEditing(r); setDialogOpen(true); }}
                    onStatus={changeStatus} onOpenFile={openAttachment} />}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nota</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead>Competência</TableHead>
                <TableHead>Cliente / Fornecedor</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.invoice_number}{r.series ? `/${r.series}` : ''}
                    {(r.xml_path || r.pdf_path) && (
                      <Paperclip className="inline ml-1 h-3 w-3 text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell>
                    {FISCAL_TYPE_LABEL[r.document_type]}
                    <span className="text-xs text-muted-foreground ml-1">
                      ({FISCAL_DIRECTION_LABEL[r.direction]})
                    </span>
                  </TableCell>
                  <TableCell>{format(new Date(r.issue_date + 'T00:00:00'), 'dd/MM/yyyy')}</TableCell>
                  <TableCell>
                    {String(r.competence_month).padStart(2, '0')}/{r.competence_year}
                  </TableCell>
                  <TableCell>{r.counterpart_name || '—'}</TableCell>
                  <TableCell className="text-right">{fmtMoney(Number(r.total_amount))}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_VARIANT[r.fiscal_status]} variant="secondary">
                      {FISCAL_STATUS_LABEL[r.fiscal_status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canManage && <RowActions row={r} onEdit={() => { setEditing(r); setDialogOpen(true); }}
                      onStatus={changeStatus} onOpenFile={openAttachment} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FiscalDocumentFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        onSaved={load}
      />
    </div>
  );
}

function RowActions({
  row, onEdit, onStatus, onOpenFile,
}: {
  row: FiscalDocumentRow;
  onEdit: () => void;
  onStatus: (row: FiscalDocumentRow, next: FiscalStatus) => void;
  onOpenFile: (path: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Ações da nota">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {row.fiscal_status !== 'cancelled' && (
          <DropdownMenuItem onClick={onEdit}>Editar</DropdownMenuItem>
        )}
        {row.xml_path && (
          <DropdownMenuItem onClick={() => onOpenFile(row.xml_path!)}>Abrir XML</DropdownMenuItem>
        )}
        {row.pdf_path && (
          <DropdownMenuItem onClick={() => onOpenFile(row.pdf_path!)}>Abrir documento</DropdownMenuItem>
        )}
        {row.fiscal_status === 'pending' && (
          <DropdownMenuItem onClick={() => onStatus(row, 'sent_to_accountant')}>
            Marcar como enviada ao contador
          </DropdownMenuItem>
        )}
        {row.fiscal_status !== 'declared' && row.fiscal_status !== 'cancelled' && (
          <DropdownMenuItem onClick={() => onStatus(row, 'declared')}>
            Marcar como declarada
          </DropdownMenuItem>
        )}
        {row.fiscal_status !== 'pending' && row.fiscal_status !== 'cancelled' && (
          <DropdownMenuItem onClick={() => onStatus(row, 'pending')}>
            Reabrir (voltar para pendente)
          </DropdownMenuItem>
        )}
        {row.fiscal_status !== 'cancelled' ? (
          <DropdownMenuItem className="text-destructive" onClick={() => onStatus(row, 'cancelled')}>
            Cancelar nota
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onStatus(row, 'pending')}>
            Reativar nota
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
