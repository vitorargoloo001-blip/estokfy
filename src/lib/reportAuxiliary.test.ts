import { expect, it } from 'vitest';
import { purchaseTotal, exchangeTotals, reconciliationPeriod, financialDateLabel } from './reportAuxiliary';

it('preserves an explicitly zero purchase total and only falls back when missing', () => {
  expect(purchaseTotal({ total_amount: 0, unit_cost: 10, qty: 3 })).toBe(0);
  expect(purchaseTotal({ total_amount: null, unit_cost: 10, qty: 3 })).toBe(30);
});
it('excludes cancelled exchanges from financial totals without hiding their history', () => {
  expect(exchangeTotals([{ status: 'completed', amount_to_pay: 20, troco_amount: 0, credit_amount: 0 }, { status: 'cancelled', amount_to_pay: 100, troco_amount: 50, credit_amount: 20 }])).toEqual({ count: 1, pay: 20, troco: 0, credito: 0 });
});
it('interprets calendar dates without moving them to the preceding day', () => {
  expect(financialDateLabel('2026-10-01')).toBe('01/10/2026');
  expect(financialDateLabel('2026-10-02T01:00:00Z')).toBe('01/10/2026');
});
it('selects whole calendar months and exactly 30 Brazilian days', () => {
  expect(reconciliationPeriod('last_month', '2026-03-01')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  expect(reconciliationPeriod('quarter', '2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  expect(reconciliationPeriod('last_30', '2026-10-01')).toEqual({ start: '2026-09-02', end: '2026-10-01' });
});
