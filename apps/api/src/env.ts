import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен (см. .env.example)'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET должен быть не короче 32 символов — сгенерируйте: openssl rand -hex 32'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // SERVER.md §7 "до запуска решить": провайдеры смс/почты. Пусто = ConsoleNotifier (только dev).
  SMS_PROVIDER_API_KEY: z.string().optional(),
  EMAIL_PROVIDER_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Некорректная конфигурация окружения:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
