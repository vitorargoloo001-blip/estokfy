export const REPORT_TIME_ZONE = 'America/Sao_Paulo';

export function reportDay(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function validReportRange(from: string, to: string): boolean {
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  return validDate(from) && validDate(to) && from <= to;
}

interface PageResult<T> { data: T[] | null; error: unknown; }
interface RangeQuery<T> { range(from: number, to: number): PromiseLike<PageResult<T>>; }

/** Callers must use a stable, unique order. Never export successful partial reads. */
export async function fetchAllReportRows<T>(query: () => RangeQuery<T>): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await query().range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data) throw new Error('O relatório não retornou os dados esperados.');
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

export const isValidReportSale = (sale: { status?: string; deleted_at?: string | null }) =>
  !sale.deleted_at && !['cancelled', 'refunded', 'returned'].includes(sale.status || '');

export const isCashReportMethod = (method: string | null | undefined) =>
  !['pending', 'a_prazo', 'credit', 'return_offset'].includes((method || '').toLowerCase());

export const roundReportMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
