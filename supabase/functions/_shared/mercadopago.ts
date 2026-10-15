// Estokfy Connect — Mercado Pago: código puro (sem imports, só Web APIs),
// usado pelas Edge Functions mercadopago-* e testado em
// src/lib/mercadopago.test.ts.

export const MP_API = 'https://api.mercadopago.com';
export const MP_PROVIDER = 'mercado_pago';
export const MP_TIME_ZONE = 'America/Sao_Paulo';

// ── Assinatura do webhook ─────────────────────────────────────────────
// Documentação oficial ("Validar origem da notificação"):
//   header x-signature: "ts=<ts>,v1=<hmac hex>"
//   manifest: "id:[data.id da query];request-id:[x-request-id];ts:[ts];"
//   - data.id alfanumérico vai em minúsculas
//   - parte ausente (data.id ou x-request-id) é removida do manifest
//   HMAC-SHA256 em hex, chave = assinatura secreta da aplicação.

export function parseMpSignatureHeader(header: string | null | undefined): { ts: string; v1: string } | null {
  if (!header) return null;
  let ts = '';
  let v1 = '';
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'v1') v1 = value;
  }
  if (!ts || !/^[0-9a-f]{64}$/i.test(v1)) return null;
  return { ts, v1 };
}

export function buildMpSignatureManifest(
  dataId: string | null | undefined,
  requestId: string | null | undefined,
  ts: string,
  lowercaseId = true,
): string {
  let manifest = '';
  if (dataId) manifest += `id:${lowercaseId ? dataId.toLowerCase() : dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  return manifest;
}

export async function verifyMpSignature(input: {
  xSignature: string | null | undefined;
  xRequestId: string | null | undefined;
  dataId: string | null | undefined;
  secret: string | null | undefined;
}): Promise<boolean> {
  if (!input.secret) return false;
  const parsed = parseMpSignatureHeader(input.xSignature);
  if (!parsed) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(input.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const signature = new Uint8Array(32);
    for (let i = 0; i < signature.length; i++) signature[i] = parseInt(parsed.v1.slice(i * 2, i * 2 + 2), 16);
    // A documentação manda usar o data.id em minúsculas, mas as notificações
    // de order (ex.: "ORDTST01...") chegam assinadas com o id como veio —
    // confirmado em 2026-10-16 contra uma notificação real. Aceita as duas.
    const manifests = new Set([
      buildMpSignatureManifest(input.dataId, input.xRequestId, parsed.ts, true),
      buildMpSignatureManifest(input.dataId, input.xRequestId, parsed.ts, false),
    ]);
    for (const manifest of manifests) {
      // crypto.subtle.verify compara em tempo constante.
      if (await crypto.subtle.verify('HMAC', key, signature, encoder.encode(manifest))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Pagamento → formato canônico do Connect ───────────────────────────

export interface MpFeeDetail {
  type?: string | null;
  amount?: number | null;
  fee_payer?: string | null;
}

export interface MpPayment {
  id: number | string;
  status?: string | null;
  status_detail?: string | null;
  date_created?: string | null;
  date_approved?: string | null;
  date_last_updated?: string | null;
  money_release_date?: string | null;
  transaction_amount?: number | null;
  transaction_amount_refunded?: number | null;
  currency_id?: string | null;
  transaction_details?: {
    net_received_amount?: number | null;
    total_paid_amount?: number | null;
    installment_amount?: number | null;
    overpaid_amount?: number | null;
  } | null;
  fee_details?: MpFeeDetail[] | null;
  installments?: number | null;
  payment_method_id?: string | null;
  payment_type_id?: string | null;
  operation_type?: string | null;
  external_reference?: string | null;
  description?: string | null;
  collector_id?: number | string | null;
  live_mode?: boolean | null;
  payer?: {
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  point_of_interaction?: { type?: string | null } | null;
}

/** Valores aceitos por bank_transactions.method (CHECK constraint). */
export type ConnectMethod = 'pix' | 'credit_card' | 'debit_card' | 'boleto' | 'other';

export interface NormalizedMpTransaction {
  payment_id: string;
  provider_status: string;
  date_approved: string | null;
  date_last_updated: string | null;
  transaction_date: string;
  transaction_time: string | null;
  gross_amount: number;
  fee_amount: number | null;
  net_amount: number | null;
  refunded_amount: number;
  method: ConnectMethod;
  payer_name: string | null;
  payer_email: string | null;
  external_reference: string | null;
  description: string;
  raw_data: Record<string, unknown>;
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function mapMpMethod(paymentMethodId: string | null | undefined, paymentTypeId: string | null | undefined): ConnectMethod {
  const method = (paymentMethodId ?? '').toLowerCase();
  const type = (paymentTypeId ?? '').toLowerCase();
  if (method === 'pix' || type === 'bank_transfer') return 'pix';
  if (type === 'credit_card') return 'credit_card';
  if (type === 'debit_card' || type === 'prepaid_card') return 'debit_card';
  if (type === 'ticket') return 'boleto';
  return 'other';
}

const METHOD_LABEL: Record<ConnectMethod, string> = {
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  boleto: 'Boleto',
  other: 'Outro',
};

/** Data (YYYY-MM-DD) e hora (HH:MM:SS) no fuso de São Paulo. */
export function toSaoPauloDateTime(iso: string): { date: string; time: string } | null {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MP_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(parsed);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
  };
}

/**
 * Converte um pagamento da Payments API no formato que
 * upsert_bank_transaction_mercadopago espera. Retorna null quando o
 * pagamento não é um recebimento desta conta (a conta é a pagadora, outra
 * moeda, sem valor). O status (aprovado ou não) é decidido no banco.
 */
export function normalizeMpPayment(payment: MpPayment, mpUserId: string): NormalizedMpTransaction | null {
  if (payment.collector_id == null || String(payment.collector_id) !== String(mpUserId)) return null;
  if (payment.currency_id && payment.currency_id !== 'BRL') return null;

  const gross = finite(payment.transaction_amount);
  if (gross == null || gross <= 0) return null;

  const reference = payment.date_approved ?? payment.date_created;
  const local = reference ? toSaoPauloDateTime(reference) : null;
  if (!local) return null;

  const feeDetails = Array.isArray(payment.fee_details) ? payment.fee_details : [];
  const collectorFees = feeDetails.filter((f) => !f.fee_payer || f.fee_payer === 'collector');
  const netReceived = finite(payment.transaction_details?.net_received_amount);

  let fee: number | null = null;
  if (collectorFees.length > 0) {
    fee = roundMoney(collectorFees.reduce((sum, f) => sum + (finite(f.amount) ?? 0), 0));
  } else if (netReceived != null && netReceived > 0) {
    fee = roundMoney(gross - netReceived);
  }

  let net: number | null = null;
  if (netReceived != null && netReceived > 0) net = roundMoney(netReceived);
  else if (fee != null && payment.date_approved) net = roundMoney(gross - fee);

  const method = mapMpMethod(payment.payment_method_id, payment.payment_type_id);
  const payerName = [payment.payer?.first_name, payment.payer?.last_name]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ') || null;

  return {
    payment_id: String(payment.id),
    provider_status: payment.status ?? 'unknown',
    date_approved: payment.date_approved ?? null,
    date_last_updated: payment.date_last_updated ?? null,
    transaction_date: local.date,
    transaction_time: local.time,
    gross_amount: roundMoney(gross),
    fee_amount: fee,
    net_amount: net,
    refunded_amount: roundMoney(finite(payment.transaction_amount_refunded) ?? 0),
    method,
    payer_name: payerName,
    payer_email: payment.payer?.email?.trim() || null,
    external_reference: payment.external_reference?.trim() || null,
    description: `Mercado Pago · ${payerName ?? 'pagador não identificado'} · ${METHOD_LABEL[method]}`,
    raw_data: redactMpPayment(payment),
  };
}

/**
 * Lista branca do que vai para bank_transactions.raw_data. Fica de fora tudo
 * que identifica pessoa ou cartão (documento, telefone, endereço, cartão,
 * additional_info) — nome e e-mail do pagador ficam em colunas próprias.
 */
export function redactMpPayment(payment: MpPayment): Record<string, unknown> {
  return {
    id: payment.id,
    status: payment.status ?? null,
    status_detail: payment.status_detail ?? null,
    date_created: payment.date_created ?? null,
    date_approved: payment.date_approved ?? null,
    date_last_updated: payment.date_last_updated ?? null,
    money_release_date: payment.money_release_date ?? null,
    transaction_amount: payment.transaction_amount ?? null,
    transaction_amount_refunded: payment.transaction_amount_refunded ?? null,
    currency_id: payment.currency_id ?? null,
    installments: payment.installments ?? null,
    payment_method_id: payment.payment_method_id ?? null,
    payment_type_id: payment.payment_type_id ?? null,
    operation_type: payment.operation_type ?? null,
    external_reference: payment.external_reference ?? null,
    description: payment.description ?? null,
    collector_id: payment.collector_id ?? null,
    live_mode: payment.live_mode ?? null,
    point_of_interaction_type: payment.point_of_interaction?.type ?? null,
    fee_details: (payment.fee_details ?? []).map((f) => ({
      type: f.type ?? null,
      amount: f.amount ?? null,
      fee_payer: f.fee_payer ?? null,
    })),
    transaction_details: {
      net_received_amount: payment.transaction_details?.net_received_amount ?? null,
      total_paid_amount: payment.transaction_details?.total_paid_amount ?? null,
      installment_amount: payment.transaction_details?.installment_amount ?? null,
      overpaid_amount: payment.transaction_details?.overpaid_amount ?? null,
    },
  };
}

// ── Busca incremental ─────────────────────────────────────────────────

export const MP_SEARCH_PAGE_SIZE = 50;   // máximo documentado
export const MP_SEARCH_MAX_OFFSET = 10000; // máximo documentado
export const MP_SYNC_OVERLAP_MS = 10 * 60 * 1000;

/** GET /v1/payments/search por date_last_updated, do mais antigo pro mais novo. */
export function buildPaymentsSearchPath(beginIso: string, endIso: string, offset: number): string {
  const params = new URLSearchParams({
    range: 'date_last_updated',
    begin_date: beginIso,
    end_date: endIso,
    sort: 'date_last_updated',
    criteria: 'asc',
    limit: String(MP_SEARCH_PAGE_SIZE),
    offset: String(offset),
  });
  return `/v1/payments/search?${params.toString()}`;
}

/** Início da janela: cursor salvo menos uma sobreposição (reprocessar é inofensivo). */
export function syncWindowStart(cursorIso: string | null | undefined, fallbackIso: string): string {
  const base = cursorIso && Number.isFinite(new Date(cursorIso).getTime()) ? cursorIso : fallbackIso;
  return new Date(new Date(base).getTime() - MP_SYNC_OVERLAP_MS).toISOString();
}

// ── Cliente HTTP ──────────────────────────────────────────────────────

export class MpApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'MpApiError';
    this.status = status;
  }
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;

export async function mpFetch<T>(
  path: string,
  accessToken: string,
  options: { fetchImpl?: typeof fetch; retries?: number; timeoutMs?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 10000;
  const baseDelayMs = options.baseDelayMs ?? 500;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    // AbortController + setTimeout (e não AbortSignal.timeout) para o limite
    // cobrir também a leitura do corpo e funcionar fora do Deno (testes).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${MP_API}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      if (res.ok) return await res.json() as T;
      const body = (await res.text()).slice(0, 300);
      lastError = new MpApiError(res.status, `Mercado Pago GET ${path.split('?')[0]} (${res.status}): ${body}`);
      if (!RETRYABLE(res.status)) throw lastError;
    } catch (err) {
      if (err instanceof MpApiError && !RETRYABLE(err.status)) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
