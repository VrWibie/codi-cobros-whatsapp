import 'dotenv/config';

export const config = {
  peyApiKey: process.env.PEY_API_KEY ?? '',
  peyBaseUrl: process.env.PEY_BASE_URL ?? 'https://api.pey.mx',
  webhookSecret: process.env.PEY_WEBHOOK_SECRET ?? '',
  bankAccountId: process.env.PEY_BANK_ACCOUNT_ID || undefined,
  maxAmount: Number(process.env.MAX_AMOUNT ?? 8000),
  openaiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  waToken: process.env.WA_TOKEN ?? '',
  waPhoneNumberId: process.env.WA_PHONE_NUMBER_ID ?? '',
  waVerifyToken: process.env.WA_VERIFY_TOKEN ?? '',
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  port: Number(process.env.PORT ?? 3000),
};
