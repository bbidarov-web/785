import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен (см. .env.example)'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET должен быть не короче 32 символов — сгенерируйте: openssl rand -hex 32'),
  AUDIT_LOG_SECRET: z.string().min(32, 'AUDIT_LOG_SECRET должен быть не короче 32 символов — сгенерируйте: openssl rand -hex 32'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // SERVER.md §7 "до запуска решить": провайдеры смс/почты (SMS.ru / Resend — infra/providers/httpNotifier.ts).
  // Пусто = ConsoleNotifier (только dev) вместо реальной отправки.
  SMS_PROVIDER_API_KEY: z.string().optional(),
  EMAIL_PROVIDER_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Контур 785 <noreply@standart-kachestva.ru>'),
  // Файловое хранилище (README «Что дальше», п.1): `local` — диск сервера (годится для
  // одного инстанса, дев/первый VPS), `s3` — любой S3-совместимый провайдер (не только
  // AWS — Selectel/Yandex Object Storage/VK Cloud для хостинга в РФ, тоже подходят).
  FILES_DRIVER: z.enum(['local', 's3']).default('local'),
  FILES_DIR: z.string().default('./var/uploads'),
  FILES_S3_BUCKET: z.string().optional(),
  FILES_S3_REGION: z.string().optional(),
  FILES_S3_ENDPOINT: z.string().optional(),
  FILES_S3_ACCESS_KEY_ID: z.string().optional(),
  FILES_S3_SECRET_ACCESS_KEY: z.string().optional(),
  FILES_S3_FORCE_PATH_STYLE: z.coerce.boolean().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = schema
    .superRefine((env, ctx) => {
      if (env.FILES_DRIVER === 's3' && !env.FILES_S3_BUCKET) {
        ctx.addIssue({ code: 'custom', path: ['FILES_S3_BUCKET'], message: 'обязателен, когда FILES_DRIVER=s3' });
      }
    })
    .safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Некорректная конфигурация окружения:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
