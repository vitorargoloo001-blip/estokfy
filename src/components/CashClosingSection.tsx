import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DollarSign, Banknote, Smartphone, CreditCard, ArrowLeftRight } from 'lucide-react';
import { TZ_BR } from '@/lib/dateBR';
import {
  CASH_METHOD_LABEL, filterCashEntries, sumAmounts, type CashData, type CashFilter,
} from '@/lib/reportCash';

const fmt = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: TZ_BR, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDay = (day: string | null) => (day ? day.split('-').reverse().join('/') : '—');
const FILTERS: { value: CashFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'pix', label: 'PIX' },
  { value: 'card', label: 'Cartão' },
];

export default function CashClosingSection({ caixa }: { caixa: CashData }) {
  const [filter, setFilter] = useState<CashFilter>('all');

  const group = (methods: string[]) => methods.reduce(
    (acc, m) => {
      const v = caixa.by_method[m];
      if (v) { acc.amount += v.amount; acc.sales += v.sales_amount; acc.receivables += v.receivables_amount; }
      return acc;
    },
    { amount: 0, sales: 0, receivables: 0 },
  );
  const cash = group(['cash']);
  const pix = group(['pix']);
  const card = group(['debit_card', 'credit_card', 'card']);
  const transfer = group(['transfer']);

  const tiles = [
    { label: 'Dinheiro', icon: Banknote, tone: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', t: cash },
    { label: 'PIX', icon: Smartphone, tone: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10', t: pix },
    { label: 'Cartão', icon: CreditCard, tone: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/10', t: card },
    ...(transfer.amount > 0 ? [{ label: 'Transferência', icon: ArrowLeftRight, tone: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500/10', t: transfer }] : []),
  ];

  const visible = useMemo(() => filterCashEntries(caixa.entries, filter), [caixa.entries, filter]);
  const onTheSpot = visible.filter(e => e.kind === 'venda');
  const receivables = visible.filter(e => e.kind === 'recebimento');
  const noCash = caixa.non_cash.credit + caixa.non_cash.return_offset;

  return (
    <section className="space-y-3" data-report-screen-only>
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fechamento de caixa</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">Tudo que entrou no período, pela data do pagamento. Confira Dinheiro e PIX com a gaveta e o extrato.</p>
        </div>
      </div>

      <div className={`grid gap-3 grid-cols-2 ${tiles.length > 3 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        {tiles.map(tile => {
          const Icon = tile.icon;
          return (
            <Card key={tile.label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`h-8 w-8 rounded-lg ${tile.bg} flex items-center justify-center`}><Icon className={`h-4 w-4 ${tile.tone}`} /></div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{tile.label}</span>
                </div>
                <div className="text-lg md:text-xl font-bold tabular-nums">{fmt(tile.t.amount)}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">vendas na hora {fmt(tile.t.sales)} · a receber {fmt(tile.t.receivables)}</div>
              </CardContent>
            </Card>
          );
        })}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center"><DollarSign className="h-4 w-4 text-primary" /></div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Total que entrou</span>
            </div>
            <div className="text-lg md:text-xl font-bold tabular-nums">{fmt(caixa.total)}</div>
            <div className="text-[11px] text-muted-foreground">{caixa.entries.length} lançamento(s)</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 md:p-5 space-y-5">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por forma de pagamento">
            {FILTERS.map(f => (
              <Button key={f.value} size="sm" variant={filter === f.value ? 'default' : 'outline'} onClick={() => setFilter(f.value)} aria-pressed={filter === f.value}>
                {f.label}
              </Button>
            ))}
          </div>

          <EntryTable
            title="Vendas pagas na hora"
            empty="Nenhuma venda paga na hora neste filtro."
            rows={onTheSpot}
            total={sumAmounts(onTheSpot)}
            extra={e => (e.sale_date ? `Venda de ${fmtDay(e.sale_date)}` : '')}
          />
          <EntryTable
            title="Contas a receber pagas"
            empty="Nenhuma conta a receber paga neste filtro."
            rows={receivables}
            total={sumAmounts(receivables)}
            extra={e => `Venda de ${fmtDay(e.sale_date)}${e.registered_at.slice(0, 10) !== e.time.slice(0, 10) ? ` · lançado em ${fmtTime(e.registered_at)}` : ''}`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 md:p-5">
          <h3 className="text-sm font-semibold mb-1">Vendas em aberto (fiado)</h3>
          <p className="text-[11px] text-muted-foreground mb-3">Não entraram no caixa no ato. “Ainda em aberto” mostra o saldo de hoje.</p>
          {caixa.open_sales.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma venda ficou em aberto no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground text-left">
                  <tr><th className="py-2 pr-2 font-medium">Hora</th><th className="py-2 pr-2 font-medium">Cliente</th><th className="py-2 pr-2 font-medium">Vendedor(a)</th><th className="py-2 pr-2 font-medium text-right">Total</th><th className="py-2 pr-2 font-medium text-right">Ficou em aberto</th><th className="py-2 pr-2 font-medium text-right">Ainda em aberto</th><th className="py-2 font-medium">Vencimento</th></tr>
                </thead>
                <tbody>
                  {caixa.open_sales.map(o => (
                    <tr key={o.sale_id} className="border-t">
                      <td className="py-2 pr-2 tabular-nums text-muted-foreground whitespace-nowrap">{fmtTime(o.time)}</td>
                      <td className="py-2 pr-2 break-words">{o.customer}</td>
                      <td className="py-2 pr-2">{o.seller}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{fmt(o.net)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{fmt(o.open_at_sale)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums font-semibold">{fmt(o.pending_now)}</td>
                      <td className="py-2 tabular-nums">{fmtDay(o.due_date)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold"><td colSpan={5} className="py-2 text-right">Saldo ainda em aberto</td><td className="py-2 pr-2 text-right tabular-nums">{fmt(caixa.open_total)}</td><td /></tr>
                </tfoot>
              </table>
            </div>
          )}
          {noCash > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Não entram no caixa: crédito de loja {fmt(caixa.non_cash.credit)} · abatimento de devolução {fmt(caixa.non_cash.return_offset)}.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EntryTable({ title, empty, rows, total, extra }: {
  title: string; empty: string; rows: CashData['entries']; total: number; extra: (e: CashData['entries'][number]) => string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">{title} <span className="text-[11px] font-normal text-muted-foreground">· {rows.length}</span></h3>
        <span className="text-sm font-semibold tabular-nums">{fmt(total)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground text-left">
              <tr><th className="py-2 pr-2 font-medium">Hora</th><th className="py-2 pr-2 font-medium">Cliente</th><th className="py-2 pr-2 font-medium">Vendedor(a)</th><th className="py-2 pr-2 font-medium">Forma</th><th className="py-2 font-medium text-right">Valor</th></tr>
            </thead>
            <tbody>
              {rows.map(e => (
                <tr key={e.id} className="border-t">
                  <td className="py-2 pr-2 tabular-nums text-muted-foreground whitespace-nowrap">{fmtTime(e.time)}</td>
                  <td className="py-2 pr-2 break-words">
                    {e.customer}
                    <div className="text-[11px] text-muted-foreground">{extra(e)}</div>
                  </td>
                  <td className="py-2 pr-2">{e.seller}</td>
                  <td className="py-2 pr-2">{CASH_METHOD_LABEL[e.method] || e.method}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{fmt(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
