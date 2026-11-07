import OpenAI from 'openai';
import { z } from 'zod';
import { config } from './config.js';

export const Intent = z.object({
  intent: z.enum(['cobrar', 'estado', 'resumen', 'ayuda', 'otro']),
  amount: z.number().nullable().default(null),
  concept: z.string().nullable().default(null),
  payerPhone: z.string().nullable().default(null), // 10 dígitos
});
export type Intent = z.infer<typeof Intent>;

export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  const t = d.length >= 10 ? d.slice(-10) : '';
  return t.length === 10 ? t : null;
}

/** Parser por reglas: respaldo sin IA y para pruebas. */
export function parseByRules(text: string): Intent {
  const t = text.trim();
  const low = t.toLowerCase();
  if (/^(ayuda|help|menu|menú|hola)\b/.test(low)) return { intent: 'ayuda', amount: null, concept: null, payerPhone: null };
  if (/\b(resumen|corte|ventas de hoy|cuánto llevo|cuanto llevo)\b/.test(low)) return { intent: 'resumen', amount: null, concept: null, payerPhone: null };
  if (/\b(estado|pendientes|quién me debe|quien me debe|pagó|pago)\b/.test(low) && !/\$|\d{2,}\s*(pesos|mxn)?/.test(low.replace(/\d{10}/, '')))
    return { intent: 'estado', amount: null, concept: null, payerPhone: null };

  if (/\b(cobr|cobra|cobrale|cóbrale|cobro|generar qr|qr)\b/.test(low)) {
    const phoneMatch = t.match(/(?:\+?52\s*)?(\d[\d\s-]{8,13}\d)/);
    const phone = phoneMatch ? normalizePhone(phoneMatch[1]) : null;
    const rest = phone ? t.replace(phoneMatch![0], ' ') : t;
    const amt = rest.match(/\$?\s*(\d+(?:[.,]\d{1,2})?)\s*(?:pesos|mxn|\$)?/i);
    const amount = amt ? Number(amt[1].replace(',', '.')) : null;
    const conceptMatch = rest.match(/\b(?:por|de|concepto)\s+(.+)$/i);
    const concept = conceptMatch ? conceptMatch[1].replace(/\s+/g, ' ').trim() : null;
    return { intent: 'cobrar', amount, concept, payerPhone: phone };
  }
  return { intent: 'otro', amount: null, concept: null, payerPhone: null };
}

const SYSTEM = `Eres el intérprete de un bot de cobros por WhatsApp para comercios en México.
Devuelve SOLO JSON: {"intent":"cobrar|estado|resumen|ayuda|otro","amount":number|null,"concept":string|null,"payerPhone":string|null}.
- cobrar: el comerciante pide cobrar (amount en MXN; payerPhone = 10 dígitos si lo menciona; concept = breve).
- estado: pregunta por cobros pendientes/pagados. resumen: corte/ventas del día. ayuda: saludo o ayuda.
No inventes montos ni teléfonos.`;

export async function parseMessage(text: string): Promise<Intent> {
  if (!config.openaiKey) return parseByRules(text);
  try {
    const client = new OpenAI({ apiKey: config.openaiKey });
    const r = await client.chat.completions.create({
      model: config.openaiModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: text }],
    });
    const parsed = Intent.parse(JSON.parse(r.choices[0].message.content ?? '{}'));
    if (parsed.payerPhone) parsed.payerPhone = normalizePhone(parsed.payerPhone);
    return parsed;
  } catch (e) {
    console.error('LLM falló, uso reglas:', (e as Error).message);
    return parseByRules(text);
  }
}
