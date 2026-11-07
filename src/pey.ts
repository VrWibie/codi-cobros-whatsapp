// Cliente mínimo de la API pública de pey (OpenAPI 2026-10-20). Auth: Bearer API key.
export type PeyMetadata = Record<string, string | number | boolean | null>;

export interface CreateQrInput {
  amount: number; // 0 = el pagador captura el monto
  concept?: string;
  expiration?: number; // segundos, 0 = sin expiración, mínimo 360
  numRef?: string; // 1-7 dígitos
  bankAccountId?: string;
  metadata?: PeyMetadata;
}
export interface CreateQrResult { id: string; qrString: string; qrImage?: string | null }

export interface CreatePushInput {
  amount: number;
  phoneNumber: string; // 10 dígitos
  concept?: string;
  expiration?: number; // >= 360
  numRef?: string;
  bankAccountId?: string;
  metadata?: PeyMetadata;
}
export interface CreatePushResult { transactionId: string; codiId: string }

export interface PeyTransaction {
  id: string;
  status: 'PENDING' | 'PAID';
  amount: number;
  paymentMethod: 'CARD' | 'CODI';
  payableType: 'PAYMENT_LINK' | 'API_CODI_QR' | 'API_CODI_PN';
  payableId?: string;
}

export class PeyError extends Error {
  constructor(public status: number, public type: string, message: string, public requestId?: string) {
    super(`[pey ${status} ${type}] ${message}`);
  }
}

export interface PeyClientOptions { apiKey: string; baseUrl?: string; fetch?: typeof fetch }

export class PeyClient {
  private f: typeof fetch;
  constructor(private opts: PeyClientOptions) { this.f = opts.fetch ?? fetch; }

  private async req<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.f(`${this.opts.baseUrl ?? 'https://api.pey.mx'}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const e = json?.error ?? {};
      throw new PeyError(res.status, e.type ?? 'UNKNOWN', e.message ?? text, e.requestId);
    }
    return json as T;
  }

  createQr(i: CreateQrInput) { return this.req<CreateQrResult>('POST', '/codi/qr', i); }
  createPush(i: CreatePushInput) { return this.req<CreatePushResult>('POST', '/codi/pn', i); }
  getTransaction(id: string) { return this.req<PeyTransaction>('GET', `/transaction/${encodeURIComponent(id)}`); }
  getQrTransactions(qrId: string) { return this.req<unknown>('GET', `/transaction/codi/qr/${encodeURIComponent(qrId)}`); }
}
