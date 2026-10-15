import { describe, expect, it } from 'vitest';
import {
  buildPixOrderPayload,
  mapPixOrderStatus,
  paidAmountOf,
  parsePixOrderResponse,
  splitPayerName,
  type PixChargeRow,
  type PixOrderResponse,
} from '../../supabase/functions/_shared/mercadopago-pix';

const CHARGE: PixChargeRow = {
  id: '7c1e2a40-1111-4222-8333-944455556666',
  store_id: '86b3da2d-a69f-455a-a301-e6249f2542eb',
  sale_id: '11111111-2222-4333-8444-555555555555',
  amount: 485.5,
  status: 'creating',
};

describe('buildPixOrderPayload', () => {
  it('monta a order Pix com valor em string de 2 casas e referência = id da cobrança', () => {
    const payload = buildPixOrderPayload(CHARGE, { email: 'cliente@example.com' }) as {
      type: string;
      processing_mode: string;
      total_amount: string;
      external_reference: string;
      transactions: { payments: unknown[] };
      payer: { email: string };
    };
    expect(payload.type).toBe('online');
    expect(payload.processing_mode).toBe('automatic');
    expect(payload.total_amount).toBe('485.50');
    expect(payload.external_reference).toBe(CHARGE.id);
    expect(payload.transactions.payments[0]).toEqual({
      amount: '485.50',
      payment_method: { id: 'pix', type: 'bank_transfer' },
    });
    expect(payload.payer).toEqual({ email: 'cliente@example.com' });
  });

  it('inclui o nome do pagador quando existe e separa nome e sobrenome', () => {
    const payload = buildPixOrderPayload(CHARGE, { email: 'a@b.com', ...splitPayerName('Maria da Silva Souza') }) as {
      payer: Record<string, string>;
    };
    expect(payload.payer).toEqual({ email: 'a@b.com', first_name: 'Maria', last_name: 'da Silva Souza' });
    expect(splitPayerName('  ')).toEqual({ firstName: '', lastName: '' });
    expect(splitPayerName('APRO')).toEqual({ firstName: 'APRO', lastName: '' });
  });

  it('recusa cobrança sem e-mail do pagador', () => {
    expect(() => buildPixOrderPayload(CHARGE, { email: '  ' })).toThrow('payer_email_obrigatorio');
    expect(() => buildPixOrderPayload(CHARGE, { email: null })).toThrow('payer_email_obrigatorio');
  });
});

describe('parsePixOrderResponse', () => {
  const order: PixOrderResponse = {
    id: 'ORD01ABC',
    transactions: {
      payments: [
        {
          id: 123456789,
          payment_method: {
            id: 'pix',
            qr_code: '00020126...copiaecola',
            qr_code_base64: 'iVBORw0KGgo=',
            ticket_url: 'https://www.mercadopago.com/ticket',
          },
        },
      ],
    },
  };

  it('extrai QR Code, copia-e-cola e ids', () => {
    expect(parsePixOrderResponse(order)).toEqual({
      orderId: 'ORD01ABC',
      paymentId: '123456789',
      qrCode: '00020126...copiaecola',
      qrCodeBase64: 'iVBORw0KGgo=',
      ticketUrl: 'https://www.mercadopago.com/ticket',
    });
  });

  it('recusa resposta sem QR Code', () => {
    const semQr: PixOrderResponse = { id: 'ORD01ABC', transactions: { payments: [{ payment_method: { id: 'pix' } }] } };
    expect(() => parsePixOrderResponse(semQr)).toThrow('resposta_pix_sem_qr_code');
  });
});

describe('mapPixOrderStatus', () => {
  it.each([
    ['processed', 'accredited', 'paid'],
    ['processed', 'partially_refunded', 'pending'],
    ['action_required', 'waiting_payment', 'pending'],
    ['processing', 'in_process', 'pending'],
    ['expired', 'expired', 'expired'],
    ['canceled', 'canceled', 'cancelled'],
    ['failed', 'failed', 'failed'],
    ['refunded', 'refunded', 'pending'],
    [undefined, undefined, 'pending'],
  ])('%s/%s → %s', (status, detail, expected) => {
    expect(mapPixOrderStatus(status as string | undefined, detail as string | undefined)).toBe(expected);
  });
});

describe('paidAmountOf', () => {
  it('usa o total pago quando existe e arredonda para 2 casas', () => {
    expect(paidAmountOf({ total_paid_amount: '485.5', total_amount: '999' })).toBe(485.5);
    expect(paidAmountOf({ total_paid_amount: '10.005' })).toBe(10.01);
  });

  it('cai para o valor do pagamento e depois para o total da order', () => {
    expect(paidAmountOf({ transactions: { payments: [{ paid_amount: '20.00' }] } })).toBe(20);
    expect(paidAmountOf({ total_amount: '30' })).toBe(30);
  });

  it('devolve null quando não há valor', () => {
    expect(paidAmountOf({})).toBeNull();
    expect(paidAmountOf({ total_amount: 'abc' })).toBeNull();
  });
});
