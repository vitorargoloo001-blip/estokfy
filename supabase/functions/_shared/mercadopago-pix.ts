// Estokfy — cobrança Pix pela Orders API do Mercado Pago. Código puro (sem
// imports), usado pelas Edge Functions mercadopago-pix-create e
// mercadopago-pix-webhook e testado em src/lib/mercadopago-pix.test.ts.

export const PIX_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // padrão do Mercado Pago

export interface PixChargeRow {
  id: string;
  store_id: string;
  sale_id: string;
  amount: number;
  status: string;
}

export interface PixPayerInput {
  email: string | null | undefined;
  firstName?: string | null;
  lastName?: string | null;
}

/** Corpo de POST /v1/orders para uma cobrança Pix. Valores em string com 2 casas. */
export function buildPixOrderPayload(charge: PixChargeRow, payer: PixPayerInput): Record<string, unknown> {
  const amount = charge.amount.toFixed(2);
  const email = (payer.email ?? '').trim();
  if (!email) throw new Error('payer_email_obrigatorio');
  const firstName = (payer.firstName ?? '').trim();
  const lastName = (payer.lastName ?? '').trim();
  return {
    type: 'online',
    total_amount: amount,
    external_reference: charge.id,
    processing_mode: 'automatic',
    transactions: {
      payments: [
        {
          amount,
          payment_method: { id: 'pix', type: 'bank_transfer' },
        },
      ],
    },
    payer: {
      email,
      ...(firstName ? { first_name: firstName } : {}),
      ...(lastName ? { last_name: lastName } : {}),
    },
  };
}

/** Separa "Nome Sobrenome" em first_name e last_name (o resto vai para last_name). */
export function splitPayerName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

export interface PixOrderResponse {
  id?: string | number;
  external_reference?: string | null;
  status?: string | null;
  status_detail?: string | null;
  total_amount?: string | number | null;
  total_paid_amount?: string | number | null;
  last_updated_date?: string | null;
  transactions?: {
    payments?: Array<{
      id?: string | number | null;
      status?: string | null;
      status_detail?: string | null;
      paid_amount?: string | number | null;
      date_last_updated?: string | null;
      payment_method?: {
        id?: string | null;
        qr_code?: string | null;
        qr_code_base64?: string | null;
        ticket_url?: string | null;
      } | null;
    }> | null;
  } | null;
}

export interface PixDisplayData {
  orderId: string;
  paymentId: string | null;
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl: string;
}

/** Extrai o que o caixa precisa mostrar. Lança erro se a resposta não tiver o QR Code. */
export function parsePixOrderResponse(order: PixOrderResponse): PixDisplayData {
  const payment = order.transactions?.payments?.[0];
  const method = payment?.payment_method;
  if (order.id == null || !method?.qr_code || !method?.qr_code_base64) {
    throw new Error('resposta_pix_sem_qr_code');
  }
  return {
    orderId: String(order.id),
    paymentId: payment?.id != null ? String(payment.id) : null,
    qrCode: method.qr_code,
    qrCodeBase64: method.qr_code_base64,
    ticketUrl: method.ticket_url ?? '',
  };
}

export type PixStatus = 'paid' | 'pending' | 'expired' | 'cancelled' | 'failed';

/**
 * Traduz o status da order para o status interno da cobrança.
 * Documentação (status da order): processed + accredited = pago;
 * expired e canceled são encerramentos; failed é falha; o resto segue aberto.
 */
export function mapPixOrderStatus(status: string | null | undefined, statusDetail: string | null | undefined): PixStatus {
  if (status === 'processed' && statusDetail === 'accredited') return 'paid';
  if (status === 'expired') return 'expired';
  if (status === 'canceled' || status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'pending';
}

/** Valor efetivamente pago na order (2 casas). Usa o total pago se existir; senão o total da cobrança. */
export function paidAmountOf(order: PixOrderResponse): number | null {
  const raw = order.total_paid_amount ?? order.transactions?.payments?.[0]?.paid_amount ?? order.total_amount;
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
