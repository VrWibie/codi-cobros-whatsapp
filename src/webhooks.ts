import { Webhook } from 'standardwebhooks';
import type { Store } from './store.js';

// Payloads según docs.pey.mx/docs/webhooks
export interface PaymentReceived {
  type: 'codi.qr.payment_received' | 'codi.pn.payment_received';
  amount: number;
  apiKeyId: string;
  bankAccountId?: string;
  codiQrId?: string; // solo en QR
  concept: string;
  datePaid: number; // Unix, segundos
  metadata: { externalMetadata?: Record<string, string>; [k: string]: unknown };
  numRef: string;
  transactionId: string;
}
export interface PaymentLinkUpdated {
  type: 'payment_link.status_updated';
  apiKeyId: string;
  paymentLinkId: string;
  status: 'paid' | 'pending' | 'processing';
  clientReferenceId: string;
  transactions: unknown[];
}
export interface BankAccountUpdated {
  type: 'bank.account.updated';
  bankAccountId: string;
  codiStatus: 'ACTIVE';
  clabe: string;
  name: string;
}
export type PeyEvent = PaymentReceived | PaymentLinkUpdated | BankAccountUpdated;

/** Verifica la firma con el body CRUDO (string). Lanza si es inválida. */
export function verifyWebhook(secret: string, rawBody: string, headers: Record<string, string | string[] | undefined>): PeyEvent {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) if (typeof v === 'string') h[k.toLowerCase()] = v;
  return new Webhook(secret).verify(rawBody, h) as PeyEvent;
}

export type Notify = (merchantPhone: string, text: string) => Promise<void>;

/** Aplica el evento al almacén y avisa al comerciante. Devuelve qué pasó (útil para logs/tests). */
export async function handleEvent(ev: PeyEvent, webhookId: string | undefined, store: Store, notify: Notify): Promise<string> {
  if (webhookId && !store.markWebhookSeen(webhookId)) return 'duplicate';

  if (ev.type === 'codi.qr.payment_received' || ev.type === 'codi.pn.payment_received') {
    const ref = ev.type === 'codi.qr.payment_received' ? ev.codiQrId : ev.transactionId;
    let charge = ref ? store.findByPeyRef(ref) : undefined;
    const chargeId = ev.metadata?.externalMetadata?.chargeId;
    if (!charge && chargeId) charge = store.getCharge(chargeId); // respaldo por metadata
    if (!charge) return 'unknown-charge';
    if (charge.status === 'paid') return 'already-paid';
    charge.status = 'paid';
    charge.paidAt = ev.datePaid * 1000;
    charge.peyTransactionId = ev.transactionId;
    store.update(charge);
    await notify(charge.merchantPhone, `✅ Pago recibido: $${ev.amount.toFixed(2)} MXN — ${charge.concept}`);
    return 'paid';
  }
  if (ev.type === 'bank.account.updated') return 'bank-account-active';
  if (ev.type === 'payment_link.status_updated') return 'payment-link';
  return 'ignored';
}
