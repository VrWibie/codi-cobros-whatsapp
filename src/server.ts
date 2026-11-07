import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { config } from './config.js';
import { createBot } from './bot.js';
import { FakePey } from './fakepey.js';
import { PeyClient } from './pey.js';
import { Store } from './store.js';
import { handleEvent, verifyWebhook } from './webhooks.js';
import { extractMessages, sendImage, sendText } from './whatsapp.js';

const store = new Store(process.env.DB_FILE ?? 'data.json');
const DEMO = process.env.DEMO_MODE === '1';
const pey = DEMO ? new FakePey() : new PeyClient({ apiKey: config.peyApiKey, baseUrl: config.peyBaseUrl });
const bot = createBot({ store, pey });
const app = express();
const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Bandeja de avisos para el chat web (los comerciantes "demo-*" no usan WhatsApp real).
const inbox = new Map<string, { text: string; at: number }[]>();
const notify = async (phone: string, text: string) => {
  if (phone.startsWith('demo-')) {
    const q = inbox.get(phone) ?? []; q.push({ text, at: Date.now() }); inbox.set(phone, q);
  } else await sendText(phone, text);
};

// Webhook de pey: body CRUDO para verificar la firma.
app.post('/webhooks/pey', express.raw({ type: '*/*' }), async (req, res) => {
  const raw = req.body.toString('utf8');
  let ev;
  try { ev = verifyWebhook(config.webhookSecret, raw, req.headers); }
  catch (e) { console.warn('Firma inválida', (e as Error).message); return res.status(401).end(); }
  try {
    const r = await handleEvent(ev, req.header('webhook-id'), store, notify);
    console.log('webhook', ev.type, r);
    res.status(200).end();
  } catch (e) { console.error(e); res.status(500).end(); } // pey reintentará
});

// WhatsApp Cloud API: verificación + mensajes.
app.get('/webhooks/whatsapp', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.waVerifyToken)
    return res.send(req.query['hub.challenge']);
  res.status(403).end();
});
app.post('/webhooks/whatsapp', express.json(), async (req, res) => {
  res.status(200).end(); // responder rápido a Meta
  for (const m of extractMessages(req.body)) {
    try {
      for (const r of await bot.handle(m.from, m.text)) {
        if (r.imageUrl) await sendImage(m.from, r.imageUrl, r.text); else await sendText(m.from, r.text);
      }
    } catch (e) { console.error(e); }
  }
});

// PNG del QR (WhatsApp necesita una URL pública para la imagen).
app.get('/qr/:id.png', async (req, res) => {
  const c = store.getCharge(req.params.id);
  if (!c?.qrString) return res.status(404).end();
  res.type('png').send(await QRCode.toBuffer(c.qrString, { width: 600, margin: 2 }));
});

// ---- Demo web + panel ----
app.use('/api', express.json());
app.get('/', (_q, r) => r.sendFile(path.join(pub, 'app.html')));
app.get('/panel', (_q, r) => r.sendFile(path.join(pub, 'panel.html')));
app.get('/demo', (_q, r) => r.sendFile(path.join(pub, 'demo.html')));
app.get('/api/info', (_q, r) => r.json({ demo: DEMO, maxAmount: config.maxAmount }));
app.get('/api/charges', (_q, r) => r.json(store.allCharges().map(({ qrString, ...c }) => c)));
app.post('/api/demo/message', async (req, res) => {
  const from = String(req.body?.from ?? '');
  if (!from.startsWith('demo-')) return res.status(400).json({ error: 'from debe empezar con demo-' });
  res.json({ replies: await bot.handle(from, String(req.body?.text ?? '')) });
});
app.get('/api/demo/inbox', (req, res) => {
  const from = String(req.query.from ?? ''); const q = inbox.get(from) ?? []; inbox.set(from, []);
  res.json({ messages: q });
});
// Simula que el cliente pagó (solo en DEMO_MODE) usando el mismo camino que un webhook real.
app.post('/api/demo/pay/:id', async (req, res) => {
  if (!DEMO) return res.status(403).json({ error: 'solo en DEMO_MODE=1' });
  const c = store.getCharge(req.params.id);
  if (!c) return res.status(404).end();
  const ev: any = c.method === 'qr'
    ? { type: 'codi.qr.payment_received', codiQrId: c.peyRefId }
    : { type: 'codi.pn.payment_received' };
  const r = await handleEvent({ ...ev, amount: c.amount, apiKeyId: 'demo', concept: c.concept, datePaid: Math.floor(Date.now() / 1000),
    metadata: { externalMetadata: { chargeId: c.id } }, numRef: c.numRef, transactionId: c.method === 'push' ? c.peyRefId : `demo-tx-${Date.now()}` }, `demo-${Date.now()}`, store, notify);
  res.json({ result: r });
});

app.get('/health', (_q, r) => r.json({ ok: true }));
app.listen(config.port, () => console.log(`Escuchando en :${config.port}`));
