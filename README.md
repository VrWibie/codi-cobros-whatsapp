# Cobros CoDi por WhatsApp con IA (Hackatón México 2026)

Bot de WhatsApp para comercios: "cóbrale 350 a 5512345678 por 2 tortas" → confirma → crea QR o solicitud push CoDi con la API de pey → avisa cuando llega el pago (webhook firmado).

## Arranque
```
cp .env.example .env   # llenar PEY_API_KEY y PEY_WEBHOOK_SECRET
npm test               # 9 pruebas (sin red)
npm run dev            # :3000
```
Exponer con un túnel (ngrok/cloudflared) y registrar:
- Webhook pey → `POST {PUBLIC_URL}/webhooks/pey` (portal pey → API key → Webhooks; copiar el secreto `whsec_…`)
- Webhook Meta → `{PUBLIC_URL}/webhooks/whatsapp` (verify token = `WA_VERIFY_TOKEN`)

## Modo demo (sin WhatsApp ni pey)
```
DEMO_MODE=1 npm run dev
```
- `http://localhost:3000/demo` → chat tipo WhatsApp para hablar con el bot.
- `http://localhost:3000/panel` → cobros en vivo; botón "Simular pago" dispara el mismo camino que un webhook real.

## Notas de la API de pey
- Solo producción (`https://api.pey.mx`); probar con $0.01 MXN.
- QR: `POST /codi/qr` · Push: `POST /codi/pn` (teléfono 10 dígitos, vence ≥ 360 s).
- Webhooks: `codi.qr.payment_received` (se liga por `codiQrId`), `codi.pn.payment_received` (por `transactionId`), `payment_link.status_updated`, `bank.account.updated`. Nuestra `metadata` llega en `metadata.externalMetadata`.
- Idempotencia con el encabezado `webhook-id`; la firma se valida sobre el body crudo.
- Registrar CLABE (`POST /bank-account`) tarda hasta 5 días hábiles.

## Estructura
`src/pey.ts` cliente API · `src/webhooks.ts` verificación y eventos · `src/bot.ts` conversación · `src/parser.ts` IA (OpenAI) con respaldo por reglas · `src/whatsapp.ts` Meta Cloud API · `src/store.ts` almacén JSON.
