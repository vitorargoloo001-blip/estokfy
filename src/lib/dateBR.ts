/**
 * Helpers de data fixados em America/Sao_Paulo (UTC-03:00).
 * Banco continua armazenando UTC; aqui só convertemos para faixas locais
 * e formatos de exibição corretos para o Brasil.
 */

export const TZ_BR = 'America/Sao_Paulo';

/** Retorna {y, m, d} do "agora" no fuso BR (mês 1-12). */
function nowPartsBR(base: Date = new Date()): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_BR,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(base);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** "YYYY-MM-DD" do dia atual no fuso BR. */
export function todayStrBR(): string {
  const { y, m, d } = nowPartsBR();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" de N dias atrás (no fuso BR). */
export function daysAgoStrBR(n: number): string {
  const { y, m, d } = nowPartsBR();
  // monta um Date "ancorado" ao meio-dia BR (= 15:00 UTC) para evitar edge no DST
  const anchor = new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() - n);
  const y2 = anchor.getUTCFullYear();
  const m2 = String(anchor.getUTCMonth() + 1).padStart(2, '0');
  const d2 = String(anchor.getUTCDate()).padStart(2, '0');
  return `${y2}-${m2}-${d2}`;
}

/** "YYYY-MM-DD" do primeiro dia do mês atual no fuso BR. */
export function firstOfMonthStrBR(): string {
  const { y, m } = nowPartsBR();
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

/**
 * Converte "YYYY-MM-DD" (data BR) em ISO UTC do início desse dia (00:00 BR = 03:00 UTC).
 * Use em filtros .gte('created_at', startOfDayBRtoUTCISO('2026-04-17'))
 */
export function startOfDayBRtoUTCISO(yyyyMmDd: string): string {
  // 00:00 em São Paulo == 03:00 UTC (UTC-03)
  return `${yyyyMmDd}T03:00:00.000Z`;
}

/** ISO UTC do FIM do dia BR (23:59:59.999 BR). */
export function endOfDayBRtoUTCISO(yyyyMmDd: string): string {
  // 23:59:59.999 em São Paulo == 02:59:59.999 UTC do dia seguinte
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const nextUTC = new Date(Date.UTC(y, m - 1, d + 1, 2, 59, 59, 999));
  return nextUTC.toISOString();
}

/** ISO UTC do início do dia de HOJE no fuso BR. */
export function startOfTodayUTCISO(): string {
  return startOfDayBRtoUTCISO(todayStrBR());
}

/** ISO UTC do início do mês atual no fuso BR. */
export function startOfMonthUTCISO(): string {
  return startOfDayBRtoUTCISO(firstOfMonthStrBR());
}

/** ISO UTC de N dias atrás (início do dia BR). */
export function startOfDaysAgoUTCISO(n: number): string {
  return startOfDayBRtoUTCISO(daysAgoStrBR(n));
}

/** Extrai "YYYY-MM-DD" (no fuso BR) de um ISO UTC vindo do banco. */
export function isoToDayBR(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_BR,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find(p => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Formata "DD/MM" para exibição em gráficos no fuso BR. */
export function formatDayMonthBR(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ_BR,
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(iso));
}
