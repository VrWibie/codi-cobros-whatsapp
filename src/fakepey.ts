import type { CreatePushInput, CreatePushResult, CreateQrInput, CreateQrResult } from './pey.js';

/** pey simulado para demos sin API key ni dinero real (DEMO_MODE=1). */
export class FakePey {
  private n = 0;
  async createQr(i: CreateQrInput): Promise<CreateQrResult> {
    const id = `demo-qr-${++this.n}-${Date.now().toString(36)}`;
    return { id, qrString: `DEMO-CODI|${id}|${i.amount}|${i.concept ?? ''}` };
  }
  async createPush(_i: CreatePushInput): Promise<CreatePushResult> {
    const k = ++this.n;
    return { transactionId: `demo-pn-${k}-${Date.now().toString(36)}`, codiId: String(10 ** 19 + k) };
  }
}
