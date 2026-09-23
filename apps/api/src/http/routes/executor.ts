import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../plugins/session.js';

/**
 * Кабинет исполнителя — единственный экран, полностью перенесённый end-to-end
 * (см. README "Порядок работы": исполнитель → обход → клиника → панель).
 * Доступ жёстко ограничен ролью nurse на уровне сервиса (ExecutorService.getOverview).
 */
export async function executorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/executor/overview', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    if (ctx.account.role !== 'nurse') return reply.code(403).send({ ok: false, error: 'Кабинет исполнителя доступен только роли "исполнитель"' });
    const overview = await app.container.executor.getOverview(ctx.account);
    return reply.send({ ok: true, overview });
  });

  app.post('/api/executor/docs/:code/done', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    if (ctx.account.role !== 'nurse') return reply.code(403).send({ ok: false, error: 'Доступно только роли "исполнитель"' });
    const { code } = z.object({ code: z.string() }).parse(req.params);
    await app.container.executor.markDocDone(ctx.account, code);
    return reply.send({ ok: true });
  });
}
