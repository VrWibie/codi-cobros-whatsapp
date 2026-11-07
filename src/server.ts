import express from 'express';
import QRCode from 'qrcode';
import { config } from './config.js';
import { createBot } from './bot.js';
import { PeyClient } from './pey.js';
import { Store } from './store.js';
import { handleEvent, verifyWebhook } from './webhooks.js';
import { extractMessages, sendImage, sendText } from './whatsapp.js';

const store = new Store(process.env.DB_FILE ?? 'data.json');
const pey = new PeyClient({ apiKey: config.peyApiKey, baseUrl: config.peyBaseUrl });
const bot = createBot({ store, pey });
const app = express();

// Webhook de pey: body CRUDO para verificar la firma.
app.post('/webhooks/pey', express.raw({ type: '*/*' }), async (req, res) => {
  const raw = req.body.toString('utf8');
  let ev;
  try { ev = verifyWebhook(config.webhookSecret, raw, req.headers); }
  catch (e) { console.warn('Firma inválida', (e as Error).message); return res.status(401).end(); }
  try {
    const r = await handleEvent(ev, req.header('webhook-id'), store, sendText);
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

app.get('/health', (_q, r) => r.json({ ok: true }));
app.listen(config.port, () => console.log(`Escuchando en :${config.port}`));
