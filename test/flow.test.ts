import { describe, expect, it, vi } from 'vitest';
import { Webhook } from 'standardwebhooks';
import { createBot } from '../src/bot.js';
import { parseByRules } from '../src/parser.js';
import { PeyClient } from '../src/pey.js';
import { Store } from '../src/store.js';
import { handleEvent, verifyWebhook } from '../src/webhooks.js';

const SECRET = 'whsec_' + Buffer.from('super-secreto-de-prueba-1234567890').toString('base64');
const M = '5215512345678';

function signed(payload: object, id = 'msg_1') {
  const body = JSON.stringify(payload);
  const ts = new Date();
  const sig = new Webhook(SECRET).sign(id, ts, body);
  return { body, headers: { 'webhook-id': id, 'webhook-timestamp': String(Math.floor(ts.getTime() / 1000)), 'webhook-signature': sig } };
}

function mkBot(store = new Store()) {
  const pey = {
    createQr: vi.fn(async (_i: unknown) =>  ({ id: '35a13c183a', qrString: '00020101...' })),
    createPush: vi.fn(async (_i: unknown) => ({ transactionId: '01TXPN', codiId: '123' })),
  };
  let n = 0;
  return { store, pey, bot: createBot({ store, pey, newId: () => `c${++n}`, maxAmount: 8000, publicUrl: 'https://x.test' }) };
}

describe('parser por reglas', () => {
  it('cobrar con teléfono y concepto', () => {
    expect(parseByRules('cóbrale 350 a 55 1234 5678 por 2 tortas')).toMatchObject({ intent: 'cobrar', amount: 350, payerPhone: '5512345678', concept: '2 tortas' });
  });
  it('cobrar sin teléfono', () => {
    expect(parseByRules('cobra $120.50 por mensualidad')).toMatchObject({ intent: 'cobrar', amount: 120.5, payerPhone: null });
  });
  it('resumen y estado', () => {
    expect(parseByRules('resumen del día').intent).toBe('resumen');
    expect(parseByRules('pendientes').intent).toBe('estado');
  });
});

describe('bot', () => {
  it('QR: confirma, crea y notifica al pagar (webhook QR)', async () => {
    const { bot, pey, store } = mkBot();
    const r1 = await bot.handle(M, 'cóbrale 350 por 2 tortas');
    expect(r1[0].text).toContain('¿Confirmas?');
    expect(pey.createQr).not.toHaveBeenCalled();
    const r2 = await bot.handle(M, 'sí');
    expect(pey.createQr).toHaveBeenCalledOnce();
    expect(r2[0].imageUrl).toBe('https://x.test/qr/c1.png');
    expect(pey.createQr.mock.calls[0][0]).toMatchObject({ amount: 350, metadata: { chargeId: 'c1' } });

    const notify = vi.fn(async () => {});
    const ev = { type: 'codi.qr.payment_received', amount: 350, apiKeyId: 'k', codiQrId: '35a13c183a', concept: 'x', datePaid: 1790724818, metadata: {}, numRef: '1', transactionId: '01T' } as const;
    expect(await handleEvent(ev as any, 'w1', store, notify)).toBe('paid');
    expect(notify).toHaveBeenCalledWith(M, expect.stringContaining('Pago recibido'));
    expect(await handleEvent(ev as any, 'w1', store, notify)).toBe('duplicate');
  });

  it('Push: se liga por transactionId', async () => {
    const { bot, store } = mkBot();
    await bot.handle(M, 'cóbrale 100 a 5598765432 por renta');
    await bot.handle(M, 'sí');
    const notify = vi.fn(async () => {});
    const r = await handleEvent({ type: 'codi.pn.payment_received', amount: 100, apiKeyId: 'k', concept: 'x', datePaid: 1, metadata: {}, numRef: '1', transactionId: '01TXPN' } as any, 'w2', store, notify);
    expect(r).toBe('paid');
  });

  it('rechaza montos sobre el tope y permite cancelar', async () => {
    const { bot } = mkBot();
    expect((await bot.handle(M, 'cobra 9000 por mueble'))[0].text).toContain('máximo');
    await bot.handle(M, 'cobra 50 por dulce');
    expect((await bot.handle(M, 'no'))[0].text).toBe('Cobro cancelado.');
  });

  it('si pey falla avisa sin romper', async () => {
    const { bot, pey } = mkBot();
    pey.createQr.mockRejectedValueOnce(new Error('boom'));
    await bot.handle(M, 'cobra 50 por dulce');
    expect((await bot.handle(M, 'sí'))[0].text).toContain('No pude crear');
  });
});

describe('webhook firmado', () => {
  it('acepta firma válida y rechaza alterada', () => {
    const { body, headers } = signed({ type: 'bank.account.updated', bankAccountId: 'b', codiStatus: 'ACTIVE', clabe: '1', name: 'n' });
    expect(verifyWebhook(SECRET, body, headers).type).toBe('bank.account.updated');
    expect(() => verifyWebhook(SECRET, body + ' ', headers)).toThrow();
  });
});

describe('cliente pey', () => {
  it('envía Bearer y mapea errores', async () => {
    const f = vi.fn(async (_u: any, init: any) => new Response(JSON.stringify({ id: 'q', qrString: 's' }), { status: 201 }));
    const c = new PeyClient({ apiKey: 'K', fetch: f as any });
    await c.createQr({ amount: 1 });
    expect(f.mock.calls[0][0]).toBe('https://api.pey.mx/codi/qr');
    expect((f.mock.calls[0][1] as any).headers.Authorization).toBe('Bearer K');
    const bad = new PeyClient({ apiKey: 'K', fetch: (async () => new Response(JSON.stringify({ error: { type: 'INVALID_AMOUNT', message: 'm' } }), { status: 400 })) as any });
    await expect(bad.createQr({ amount: -1 })).rejects.toThrow('INVALID_AMOUNT');
  });
});
