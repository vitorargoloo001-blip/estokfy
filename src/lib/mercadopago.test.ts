import { createHmac, webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMpSignatureManifest,
  buildPaymentsSearchPath,
  mapMpMethod,
  MpApiError,
  mpFetch,
  normalizeMpPayment,
  parseMpSignatureHeader,
  syncWindowStart,
  verifyMpSignature,
  type MpPayment,
} from '../../supabase/functions/_shared/mercadopago';

const SECRET = 'segredo-de-teste-do-webhook';

// jsdom não traz crypto.subtle; as Edge Functions (Deno) usam a Web Crypto nativa.
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('TextEncoder', TextEncoder); });
afterEach(() => vi.unstubAllGlobals());

function sign(manifest: string, secret = SECRET) {
  return createHmac('sha256', secret).update(manifest).digest('hex');
}

describe('assinatura do webhook Mercado Pago', () => {
  it('lê ts e v1 do header x-signature', () => {
    const v1 = 'a'.repeat(64);
    expect(parseMpSignatureHeader(`ts=1704908010,v1=${v1}`)).toEqual({ ts: '1704908010', v1 });
    expect(parseMpSignatureHeader(` ts = 1 , v1 = ${v1} `)).toEqual({ ts: '1', v1 });
    expect(parseMpSignatureHeader('ts=1,v1=curto')).toBeNull();
    expect(parseMpSignatureHeader(`v1=${v1}`)).toBeNull();
    expect(parseMpSignatureHeader(null)).toBeNull();
  });

  it('monta o manifest como a documentação: id em minúsculas, partes ausentes omitidas', () => {
    expect(buildMpSignatureManifest('ORD01ABC', 'req-1', '99')).toBe('id:ord01abc;request-id:req-1;ts:99;');
    expect(buildMpSignatureManifest('123', null, '99')).toBe('id:123;ts:99;');
    expect(buildMpSignatureManifest(null, 'req-1', '99')).toBe('request-id:req-1;ts:99;');
  });

  it('aceita assinatura válida e recusa qualquer adulteração', async () => {
    const v1 = sign('id:999999999;request-id:req-abc;ts:1704908010;');
    const header = `ts=1704908010,v1=${v1}`;
    const base = { xSignature: header, xRequestId: 'req-abc', dataId: '999999999', secret: SECRET };

    expect(await verifyMpSignature(base)).toBe(true);
    expect(await verifyMpSignature({ ...base, dataId: '111' })).toBe(false);
    expect(await verifyMpSignature({ ...base, xRequestId: 'outro' })).toBe(false);
    expect(await verifyMpSignature({ ...base, secret: 'segredo-errado' })).toBe(false);
    expect(await verifyMpSignature({ ...base, secret: '' })).toBe(false);
    expect(await verifyMpSignature({ ...base, xSignature: null })).toBe(false);
    expect(await verifyMpSignature({ ...base, xSignature: `ts=1704908011,v1=${v1}` })).toBe(false);
  });

  it('aceita data.id no formato original (assim chegam as notificações de order)', async () => {
    expect(buildMpSignatureManifest('ORDTST01ABC', 'req-9', '77', false)).toBe('id:ORDTST01ABC;request-id:req-9;ts:77;');
    const v1 = sign('id:ORDTST01ABC;request-id:req-9;ts:77;');
    const base = { xSignature: `ts=77,v1=${v1}`, xRequestId: 'req-9', dataId: 'ORDTST01ABC', secret: SECRET };
    expect(await verifyMpSignature(base)).toBe(true);
    expect(await verifyMpSignature({ ...base, dataId: 'ORDTST01ABD' })).toBe(false);
    expect(await verifyMpSignature({ ...base, secret: 'outro-segredo' })).toBe(false);
  });

  it('valida quando x-request-id não vem na notificação', async () => {
    const v1 = sign('id:42;ts:5;');
    expect(await verifyMpSignature({ xSignature: `ts=5,v1=${v1}`, xRequestId: null, dataId: '42', secret: SECRET })).toBe(true);
  });
});

const MP_USER = '555000111';

function payment(overrides: Partial<MpPayment> = {}): MpPayment {
  return {
    id: 123456789,
    status: 'approved',
    status_detail: 'accredited',
    date_created: '2026-10-15T23:29:00.000-04:00',
    date_approved: '2026-10-15T23:30:00.000-04:00',
    date_last_updated: '2026-10-15T23:31:00.000-04:00',
    transaction_amount: 1000,
    transaction_amount_refunded: 0,
    currency_id: 'BRL',
    transaction_details: { net_received_amount: 965, total_paid_amount: 1000 },
    fee_details: [{ type: 'mercadopago_fee', amount: 35, fee_payer: 'collector' }],
    payment_method_id: 'pix',
    payment_type_id: 'bank_transfer',
    operation_type: 'regular_payment',
    external_reference: null,
    collector_id: Number(MP_USER),
    payer: { email: 'joao@example.com', first_name: 'João', last_name: 'da Silva' },
    ...overrides,
  };
}

describe('normalizeMpPayment', () => {
  it('mantém o bruto como amount e separa taxa e líquido', () => {
    const tx = normalizeMpPayment(payment(), MP_USER)!;
    expect(tx.gross_amount).toBe(1000);
    expect(tx.fee_amount).toBe(35);
    expect(tx.net_amount).toBe(965);
    expect(tx.refunded_amount).toBe(0);
    expect(tx.method).toBe('pix');
    expect(tx.payment_id).toBe('123456789');
    expect(tx.provider_status).toBe('approved');
  });

  it('usa a data de aprovação no fuso de São Paulo', () => {
    // 23:30 em -04:00 = 03:30Z = 00:30 do dia seguinte em São Paulo (-03:00)
    const tx = normalizeMpPayment(payment(), MP_USER)!;
    expect(tx.transaction_date).toBe('2026-10-16');
    expect(tx.transaction_time).toBe('00:30:00');
  });

  it('coloca o nome do pagador na descrição (usado pelo 4º passe do motor)', () => {
    expect(normalizeMpPayment(payment(), MP_USER)!.description).toBe('Mercado Pago · João da Silva · Pix');
    const anon = normalizeMpPayment(payment({ payer: { email: null, first_name: null, last_name: null } }), MP_USER)!;
    expect(anon.payer_name).toBeNull();
    expect(anon.description).toBe('Mercado Pago · pagador não identificado · Pix');
  });

  it('calcula a taxa pelo líquido quando não há fee_details', () => {
    const tx = normalizeMpPayment(payment({ fee_details: [], transaction_details: { net_received_amount: 95.01 }, transaction_amount: 100 }), MP_USER)!;
    expect(tx.fee_amount).toBe(4.99);
    expect(tx.net_amount).toBe(95.01);
  });

  it('ignora taxas pagas pelo comprador', () => {
    const tx = normalizeMpPayment(payment({
      fee_details: [
        { type: 'mercadopago_fee', amount: 35, fee_payer: 'collector' },
        { type: 'financing_fee', amount: 50, fee_payer: 'payer' },
      ],
    }), MP_USER)!;
    expect(tx.fee_amount).toBe(35);
  });

  it('descarta o que não é recebimento desta conta', () => {
    expect(normalizeMpPayment(payment({ collector_id: 999 }), MP_USER)).toBeNull();
    expect(normalizeMpPayment(payment({ collector_id: null }), MP_USER)).toBeNull();
    expect(normalizeMpPayment(payment({ currency_id: 'USD' }), MP_USER)).toBeNull();
    expect(normalizeMpPayment(payment({ transaction_amount: 0 }), MP_USER)).toBeNull();
  });

  it('não leva documento, telefone, endereço ou cartão para raw_data', () => {
    const withPii = {
      ...payment(),
      payer: { email: 'joao@example.com', first_name: 'João', last_name: 'da Silva', identification: { type: 'CPF', number: '12345678909' }, phone: { number: '999' } },
      card: { first_six_digits: '503143', last_four_digits: '6351', cardholder: { name: 'JOAO' } },
      additional_info: { payer: { address: { street_name: 'Rua X' } } },
    } as unknown as MpPayment;
    const raw = JSON.stringify(normalizeMpPayment(withPii, MP_USER)!.raw_data);
    expect(raw).not.toContain('12345678909');
    expect(raw).not.toContain('503143');
    expect(raw).not.toContain('6351');
    expect(raw).not.toContain('Rua X');
    expect(raw).not.toContain('joao@example.com');
    expect(raw).toContain('accredited');
  });

  it('mapeia formas de pagamento para os métodos aceitos em bank_transactions', () => {
    expect(mapMpMethod('pix', 'bank_transfer')).toBe('pix');
    expect(mapMpMethod('master', 'credit_card')).toBe('credit_card');
    expect(mapMpMethod('debmaster', 'debit_card')).toBe('debit_card');
    expect(mapMpMethod('x', 'prepaid_card')).toBe('debit_card');
    expect(mapMpMethod('bolbradesco', 'ticket')).toBe('boleto');
    expect(mapMpMethod('account_money', 'account_money')).toBe('other');
    expect(mapMpMethod(null, null)).toBe('other');
  });
});

describe('busca incremental', () => {
  it('monta a busca por date_last_updated em ordem crescente', () => {
    const path = buildPaymentsSearchPath('2026-10-15T10:00:00.000Z', '2026-10-15T11:00:00.000Z', 50);
    expect(path.startsWith('/v1/payments/search?')).toBe(true);
    const params = new URLSearchParams(path.split('?')[1]);
    expect(params.get('range')).toBe('date_last_updated');
    expect(params.get('sort')).toBe('date_last_updated');
    expect(params.get('criteria')).toBe('asc');
    expect(params.get('limit')).toBe('50');
    expect(params.get('offset')).toBe('50');
    expect(params.get('begin_date')).toBe('2026-10-15T10:00:00.000Z');
  });

  it('começa a janela 10 minutos antes do cursor', () => {
    expect(syncWindowStart('2026-10-15T10:00:00.000Z', '2000-01-01T00:00:00.000Z')).toBe('2026-10-15T09:50:00.000Z');
    expect(syncWindowStart(null, '2026-10-15T10:00:00.000Z')).toBe('2026-10-15T09:50:00.000Z');
    expect(syncWindowStart('lixo', '2026-10-15T10:00:00.000Z')).toBe('2026-10-15T09:50:00.000Z');
  });
});

describe('mpFetch', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('envia o token só no header Authorization e repete em erro 5xx', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('falhou', { status: 503 }))
      .mockResolvedValueOnce(ok({ id: 1 }));
    const result = await mpFetch<{ id: number }>('/v1/payments/1', 'TOKEN', { fetchImpl, baseDelayMs: 0 });
    expect(result).toEqual({ id: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.mercadopago.com/v1/payments/1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
  });

  it('não repete erro 4xx e expõe o status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nao achou', { status: 404 }));
    await expect(mpFetch('/v1/payments/1', 'TOKEN', { fetchImpl, baseDelayMs: 0 })).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('desiste depois das tentativas configuradas', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('limite', { status: 429 }));
    await expect(mpFetch('/x', 'TOKEN', { fetchImpl, retries: 2, baseDelayMs: 0 })).rejects.toBeInstanceOf(MpApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
