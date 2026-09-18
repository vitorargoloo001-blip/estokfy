export const cents = (value: number) => Math.round(value * 100);

export function validPaymentAmount(value: number): boolean {
  return Number.isFinite(value) && value > 0 && Number.isSafeInteger(cents(value))
    && Math.abs(value * 100 - cents(value)) < 1e-7;
}

/** Fail closed: a partial response must never look like a complete ledger. */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    if (!data) throw new Error('Resposta incompleta ao consultar recebimentos.');
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

export function itemBalancesMatch(
  pending: number,
  items: { id: string; line_total: number }[],
  paid: Record<string, number>,
): boolean {
  return items.length > 0 && cents(pending) === items.reduce(
    (total, item) => total + Math.max(0, cents(Number(item.line_total)) - cents(paid[item.id] || 0)), 0,
  );
}

/** Stop at the first failure: its outcome may be unknown after a timeout. */
export async function runPaymentSequence<T>(entries: T[], send: (entry: T) => Promise<unknown>) {
  let completed = 0;
  for (const entry of entries) {
    try {
      await send(entry);
      completed++;
    } catch (error) {
      return { completed, error };
    }
  }
  return { completed, error: null };
}
