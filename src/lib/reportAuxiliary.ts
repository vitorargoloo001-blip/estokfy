import { isoToDayBR, todayStrBR } from './dateBR';

export const purchaseTotal = (row: { total_amount: number | null; unit_cost: number | null; qty: number }) =>
  Number(row.total_amount ?? Number(row.unit_cost ?? 0) * Number(row.qty ?? 0));

export function exchangeTotals(rows: { status: string; amount_to_pay: number; troco_amount: number; credit_amount: number }[]) {
  return rows.filter(row => row.status !== 'cancelled').reduce((total, row) => ({
    count: total.count + 1, pay: total.pay + Number(row.amount_to_pay || 0),
    troco: total.troco + Number(row.troco_amount || 0), credito: total.credito + Number(row.credit_amount || 0),
  }), { count: 0, pay: 0, troco: 0, credito: 0 });
}

export function financialDateLabel(value: string | null) {
  if (!value) return '—';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : isoToDayBR(value);
  return day.split('-').reverse().join('/');
}

export function reconciliationPeriod(preset: string, today = todayStrBR()): { start: string; end: string } {
  const [year, month, day] = today.split('-').map(Number);
  const date = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12)).toISOString().slice(0, 10);
  switch (preset) {
    case 'current_month': return { start: date(year, month, 1), end: date(year, month + 1, 0) };
    case 'last_month': return { start: date(year, month - 1, 1), end: date(year, month, 0) };
    case 'quarter': {
      const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
      return { start: date(year, firstMonth, 1), end: date(year, firstMonth + 3, 0) };
    }
    default: return { start: date(year, month, day - 29), end: today };
  }
}
