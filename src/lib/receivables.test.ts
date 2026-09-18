import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAllRows, itemBalancesMatch, runPaymentSequence, validPaymentAmount } from './receivables';
import { todayStrBR } from './dateBR';

afterEach(() => vi.useRealTimers());

describe('receivables', () => {
  it('loads beyond the API row limit, without skipping the boundary', async () => {
    const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const fetch = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
    expect(await fetchAllRows(fetch)).toEqual(rows);
    expect(fetch.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });
  it('does not return partial balances when a later page fails', async () => {
    const error = new Error('offline');
    await expect(fetchAllRows(async from => from === 0
      ? { data: [1, 2], error: null } : { data: null, error }, 2)).rejects.toBe(error);
  });
  it('rejects missing response data', async () => {
    await expect(fetchAllRows(async () => ({ data: null, error: null }))).rejects.toThrow('incompleta');
  });
  it.each([NaN, Infinity, -1, 0, 0.001, 1.005, 10.999])('rejects invalid payment %s', value => {
    expect(validPaymentAmount(value)).toBe(false);
  });
  it.each([0.01, 0.1 + 0.2, 19.99, 100])('accepts currency amount %s', value => {
    expect(validPaymentAmount(value)).toBe(true);
  });
  it('blocks item settlement when discount, freight or legacy allocations change the balance', () => {
    const items = [{ id: 'a', line_total: 100 }];
    expect(itemBalancesMatch(80, items, { a: 20 })).toBe(true);
    expect(itemBalancesMatch(70, items, { a: 20 })).toBe(false);
    expect(itemBalancesMatch(90, items, { a: 20 })).toBe(false);
    expect(itemBalancesMatch(80, items, {})).toBe(false);
    expect(itemBalancesMatch(80, [], {})).toBe(false);
  });
  it('does not redistribute an uncertain payment to subsequent sales', async () => {
    const send = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('timeout'));
    const result = await runPaymentSequence(['first', 'second', 'third'], send);
    expect(result.completed).toBe(1);
    expect(result.error).toBeInstanceOf(Error);
    expect(send.mock.calls).toEqual([['first'], ['second']]);
  });
  it('reports completion only after every payment succeeds', async () => {
    expect(await runPaymentSequence([1, 2], async () => ({}))).toEqual({ completed: 2, error: null });
  });
  it('keeps today in Brazil after UTC midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T01:30:00Z'));
    expect(todayStrBR()).toBe('2026-09-18');
    vi.setSystemTime(new Date('2026-09-19T03:00:00Z'));
    expect(todayStrBR()).toBe('2026-09-19');
  });
});
