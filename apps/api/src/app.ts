import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { Container } from './container.js';
import { sessionPlugin } from './http/plugins/session.js';
import { authRoutes } from './http/routes/auth.js';
import { executorRoutes } from './http/routes/executor.js';
import { walkRoutes } from './http/routes/walk.js';
import { clinicRoutes } from './http/routes/clinic.js';
import { clinicExtraRoutes } from './http/routes/clinicExtras.js';
import { documentRoutes } from './http/routes/documents.js';
import { adminRoutes } from './http/routes/admin.js';
import { panelRoutes } from './http/routes/panel.js';
import { secondHandRoutes } from './http/routes/secondHand.js';

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

  // Пустое тело при Content-Type: application/json (DELETE/POST без payload) — не ошибка:
  // по умолчанию Fastify отвечает 400, и «Удалить» в кабинетах молча не работало.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = String(body ?? '');
    if (!text.trim()) return done(null, undefined);
    try { done(null, JSON.parse(text)); } catch (err) { (err as { statusCode?: number }).statusCode = 400; done(err as Error, undefined); }
  });

  await app.register(cors, { origin: opts.corsOrigin, credentials: true });
  await app.register(cookie, { secret: opts.cookieSecret });
  // Общий лимит рассчитан на кабинет, который после каждого действия перечитывает
  // ~20 эндпоинтов (loadAll); 100/мин упирались в 429 уже после пяти нажатий кнопок.
  // Подбор пароля/кодов защищён отдельно — строгим лимитом на самих auth-маршрутах.
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });

  app.decorate('container', container);
  await app.register(sessionPlugin);

  await app.register(authRoutes);
  await app.register(executorRoutes);
  await app.register(walkRoutes);
  await app.register(clinicRoutes);
  await app.register(clinicExtraRoutes);
  await app.register(documentRoutes);
  await app.register(adminRoutes);
  await app.register(panelRoutes);
  await app.register(secondHandRoutes);

  app.get('/api/health', async () => ({ ok: true }));

  app.setErrorHandler((err: Error & { validation?: unknown; statusCode?: number }, _req, reply) => {
    app.log.error(err);
    if (err.validation || err.name === 'ZodError') return reply.code(400).send({ ok: false, error: 'Некорректный запрос' });
    reply.code(500).send({ ok: false, error: 'Внутренняя ошибка сервера' });
  });

  return app;
}
