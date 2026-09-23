import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { Container } from './container.js';
import { sessionPlugin } from './http/plugins/session.js';
import { authRoutes } from './http/routes/auth.js';
import { executorRoutes } from './http/routes/executor.js';
import { documentRoutes } from './http/routes/documents.js';
import { adminRoutes } from './http/routes/admin.js';

export interface AppOptions {
  cookieSecret: string;
  corsOrigin: string;
  logger?: boolean;
}

/**
 * Собирает Fastify-приложение поверх готового контейнера сервисов.
 * Отделено от `server.ts` (который решает, ГДЕ взять контейнер — Prisma/env)
 * ровно затем, чтобы HTTP-интеграционные тесты могли подставить контейнер
 * на in-memory адаптерах и не поднимать Postgres.
 */
export async function buildApp(container: Container, opts: AppOptions) {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true });

  await app.register(cors, { origin: opts.corsOrigin, credentials: true });
  await app.register(cookie, { secret: opts.cookieSecret });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  app.decorate('container', container);
  await app.register(sessionPlugin);

  await app.register(authRoutes);
  await app.register(executorRoutes);
  await app.register(documentRoutes);
  await app.register(adminRoutes);

  app.get('/api/health', async () => ({ ok: true }));

  app.setErrorHandler((err: Error & { validation?: unknown; statusCode?: number }, _req, reply) => {
    app.log.error(err);
    if (err.validation || err.name === 'ZodError') return reply.code(400).send({ ok: false, error: 'Некорректный запрос' });
    reply.code(500).send({ ok: false, error: 'Внутренняя ошибка сервера' });
  });

  return app;
}
