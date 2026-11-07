import { config } from './config.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

export async function sendText(to: string, body: string) {
  await call(to, { type: 'text', text: { body } });
}
export async function sendImage(to: string, link: string, caption?: string) {
  await call(to, { type: 'image', image: { link, caption } });
}
async function call(to: string, payload: object) {
  if (!config.waToken || !config.waPhoneNumberId) { console.log(`[WA→${to}]`, JSON.stringify(payload)); return; }
  const r = await fetch(`${GRAPH}/${config.waPhoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.waToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload }),
  });
  if (!r.ok) console.error('WhatsApp error', r.status, await r.text());
}

/** Extrae mensajes de texto entrantes del webhook de Meta. */
export function extractMessages(body: any): { from: string; text: string }[] {
  const out: { from: string; text: string }[] = [];
  for (const e of body?.entry ?? []) for (const c of e.changes ?? [])
    for (const m of c.value?.messages ?? []) if (m.type === 'text') out.push({ from: m.from, text: m.text.body });
  return out;
}
