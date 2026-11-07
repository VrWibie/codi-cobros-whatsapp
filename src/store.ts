import fs from 'node:fs';

export type ChargeStatus = 'pending' | 'paid' | 'expired' | 'cancelled';

export interface Charge {
  id: string; // chargeId interno (va en metadata)
  merchantPhone: string; // WhatsApp del comerciante
  amount: number;
  concept: string;
  method: 'qr' | 'push';
  payerPhone?: string;
  numRef: string;
  peyRefId: string; // QR: id (codiQrId) · Push: transactionId
  codiId?: string;
  qrString?: string;
  status: ChargeStatus;
  createdAt: number;
  paidAt?: number;
  peyTransactionId?: string;
}

export interface Draft { amount: number; concept: string; payerPhone?: string }

interface Data { charges: Charge[]; drafts: Record<string, Draft>; seenWebhooks: string[]; seq: number }

/** Almacén simple (memoria + JSON opcional). Suficiente para el hackatón; cambiar por Postgres si hace falta. */
export class Store {
  private d: Data = { charges: [], drafts: {}, seenWebhooks: [], seq: 0 };
  constructor(private file?: string) {
    if (file && fs.existsSync(file)) this.d = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  private save() { if (this.file) fs.writeFileSync(this.file, JSON.stringify(this.d)); }

  nextNumRef(): string { this.d.seq = (this.d.seq % 9_999_999) + 1; this.save(); return String(this.d.seq); }
  addCharge(c: Charge) { this.d.charges.push(c); this.save(); }
  getCharge(id: string) { return this.d.charges.find((c) => c.id === id); }
  findByPeyRef(ref: string) { return this.d.charges.find((c) => c.peyRefId === ref); }
  chargesOf(merchant: string) { return this.d.charges.filter((c) => c.merchantPhone === merchant); }
  update(c: Charge) { this.save(); return c; }

  setDraft(m: string, dr: Draft) { this.d.drafts[m] = dr; this.save(); }
  getDraft(m: string) { return this.d.drafts[m]; }
  clearDraft(m: string) { delete this.d.drafts[m]; this.save(); }

  /** true si es la primera vez que se ve este webhook-id (idempotencia). */
  markWebhookSeen(id: string): boolean {
    if (this.d.seenWebhooks.includes(id)) return false;
    this.d.seenWebhooks.push(id);
    if (this.d.seenWebhooks.length > 5000) this.d.seenWebhooks.shift();
    this.save();
    return true;
  }
}
