import { config } from './config.js';
import { parseMessage, type Intent } from './parser.js';
import type { PeyClient } from './pey.js';
import type { Charge, Store } from './store.js';

export interface Reply { text: string; imageUrl?: string; chargeId?: string }
export interface BotDeps {
  store: Store;
  pey: Pick<PeyClient, 'createQr' | 'createPush'>;
  parse?: (t: string) => Promise<Intent>;
  now?: () => number;
  newId?: () => string;
  maxAmount?: number;
  publicUrl?: string;
  bankAccountId?: string;
}

const money = (n: number) => `$${n.toFixed(2)} MXN`;
const YES = /^(s[ií]|confirmo|confirmar|ok|dale|va|listo|👍)(?=$|[\s.!,])/i;
const NO = /^(no|cancelar|cancela|cancel)(?=$|[\s.!,])/i;

export function createBot(deps: BotDeps) {
  const { store, pey } = deps;
  const parse = deps.parse ?? parseMessage;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const max = deps.maxAmount ?? config.maxAmount;
  const base = deps.publicUrl ?? config.publicUrl;
  const bankAccountId = deps.bankAccountId ?? config.bankAccountId;

  async function confirm(merchant: string): Promise<Reply[]> {
    const dr = store.getDraft(merchant);
    if (!dr) return [{ text: 'No tengo ningún cobro pendiente de confirmar. Escribe, por ejemplo: "cóbrale 350 a 5512345678 por 2 tortas".' }];
    store.clearDraft(merchant);
    const id = newId();
    const numRef = store.nextNumRef();
    const metadata = { chargeId: id, merchantPhone: merchant };
    const common = { amount: dr.amount, concept: dr.concept.slice(0, 40), numRef, metadata, ...(bankAccountId ? { bankAccountId } : {}) };
    const charge: Charge = {
      id, merchantPhone: merchant, amount: dr.amount, concept: dr.concept, method: dr.payerPhone ? 'push' : 'qr',
      payerPhone: dr.payerPhone, numRef, peyRefId: '', status: 'pending', createdAt: now(),
    };
    try {
      if (dr.payerPhone) {
        const r = await pey.createPush({ ...common, phoneNumber: dr.payerPhone });
        charge.peyRefId = r.transactionId; charge.codiId = r.codiId;
        store.addCharge(charge);
        return [{ text: `📲 Solicitud de cobro enviada al ${dr.payerPhone} por ${money(dr.amount)}. Vence en 6 min. Te aviso cuando pague.` }];
      }
      const r = await pey.createQr({ ...common, expiration: 0 });
      charge.peyRefId = r.id; charge.qrString = r.qrString;
      store.addCharge(charge);
      return [{
        text: `🧾 QR CoDi por ${money(dr.amount)} (${dr.concept}). Pídele a tu cliente que lo escanee con la app de su banco. Te aviso cuando pague.`,
        imageUrl: base ? `${base}/qr/${id}.png` : undefined,
        chargeId: id,
      }];
    } catch (e) {
      console.error(e);
      return [{ text: '⚠️ No pude crear el cobro en este momento. Intenta de nuevo en un minuto.' }];
    }
  }

  async function handle(merchant: string, text: string): Promise<Reply[]> {
    if (store.getDraft(merchant)) {
      if (YES.test(text.trim())) return confirm(merchant);
      if (NO.test(text.trim())) { store.clearDraft(merchant); return [{ text: 'Cobro cancelado.' }]; }
    }
    const it = await parse(text);

    if (it.intent === 'cobrar') {
      if (!it.amount || it.amount <= 0) return [{ text: '¿De cuánto es el cobro? Ej: "cóbrale 350 a 5512345678 por 2 tortas".' }];
      if (it.amount > max) return [{ text: `El monto máximo por cobro CoDi es ${money(max)}. Divide el cobro en partes.` }];
      const concept = it.concept?.trim() || 'Cobro';
      store.setDraft(merchant, { amount: it.amount, concept, payerPhone: it.payerPhone ?? undefined });
      const via = it.payerPhone ? `solicitud al celular ${it.payerPhone}` : 'código QR';
      return [{ text: `Voy a generar ${via} por *${money(it.amount)}* — ${concept}.\n¿Confirmas? (sí / no)` }];
    }
    if (it.intent === 'estado') {
      const pend = store.chargesOf(merchant).filter((c) => c.status === 'pending');
      if (!pend.length) return [{ text: 'No tienes cobros pendientes 🎉' }];
      return [{ text: `Pendientes (${pend.length}):\n` + pend.map((c) => `• ${money(c.amount)} — ${c.concept}${c.payerPhone ? ` (${c.payerPhone})` : ''}`).join('\n') }];
    }
    if (it.intent === 'resumen') {
      const start = new Date(now()); start.setHours(0, 0, 0, 0);
      const today = store.chargesOf(merchant).filter((c) => c.createdAt >= start.getTime());
      const paid = today.filter((c) => c.status === 'paid');
      const total = paid.reduce((s, c) => s + c.amount, 0);
      const pend = today.filter((c) => c.status === 'pending').reduce((s, c) => s + c.amount, 0);
      return [{ text: `Hoy: ${paid.length} cobros pagados por ${money(total)}. Pendiente por cobrar: ${money(pend)}.` }];
    }
    return [{ text: 'Hola 👋 Soy tu cobrador CoDi. Ejemplos:\n• "cóbrale 350 por 2 tortas" → te doy un QR\n• "cóbrale 120 a 5512345678 por mensualidad" → solicitud al celular\n• "pendientes" · "resumen del día"' }];
  }

  return { handle };
}
