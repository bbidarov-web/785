import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../plugins/session.js';
import { PermissionDeniedError } from '../../rbac/service.js';

const answerSchema = z.object({
  index: z.number().int().min(0),
  answer: z.enum(['ok', 'bad']),
  comment: z.string().optional(),
  photoBase64: z.string().optional(),
  opId: z.string().min(1),
});

/**
 * Мобильный обход (README «Мобильный обход», SERVER.md §6.5 — офлайн-очередь).
 * `opId` ОБЯЗАН сгенерировать клиент в момент постановки операции в офлайн-очередь
 * (до попытки отправки) и слать тот же самый при каждом повторе. Если сервер
 * будет сам придумывать id на каждый запрос без opId — идемпотентность исчезает:
 * ретрай неподтверждённой записи без сети как раз и не может получить id от
 * сервера, потому что не получил вообще никакого ответа с первого раза.
 */
export async function walkRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/walk/plan', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    try {
      const walks = await app.container.walk.listAssigned(ctx.account);
      return reply.send({ ok: true, walks });
    } catch (err) {
      if (err instanceof PermissionDeniedError) return reply.code(403).send({ ok: false, error: err.message });
      throw err;
    }
  });

  app.get('/api/walk/plan/:planId', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { planId } = z.object({ planId: z.string() }).parse(req.params);
    try {
      const r = await app.container.walk.getDetail(ctx.account, planId);
      return reply.code(r.ok ? 200 : 404).send(r);
    } catch (err) {
      if (err instanceof PermissionDeniedError) return reply.code(403).send({ ok: false, error: err.message });
      throw err;
    }
  });

  app.post('/api/walk/plan/:planId/answer', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { planId } = z.object({ planId: z.string() }).parse(req.params);
    const body = answerSchema.parse(req.body);
    try {
      const r = await app.container.walk.answerItem(ctx.account, planId, body, body.opId);
      return reply.code(r.ok ? 200 : 400).send(r);
    } catch (err) {
      if (err instanceof PermissionDeniedError) return reply.code(403).send({ ok: false, error: err.message });
      throw err;
    }
  });

  app.post('/api/walk/plan/:planId/finish', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { planId } = z.object({ planId: z.string() }).parse(req.params);
    const { opId } = z.object({ opId: z.string().min(1) }).parse(req.body ?? {});
    try {
      const r = await app.container.walk.finish(ctx.account, planId, opId);
      return reply.code(r.ok ? 200 : 400).send(r);
    } catch (err) {
      if (err instanceof PermissionDeniedError) return reply.code(403).send({ ok: false, error: err.message });
      throw err;
    }
  });

  // фото-доказательства — только для своей клиники, id проверяет формат сам LocalDiskFileStorage
  app.get('/api/files/:id', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const file = await app.container.repos.files.read(ctx.account.inn, id);
    if (!file) return reply.code(404).send({ ok: false, error: 'Файл не найден' });
    reply.header('Content-Type', file.contentType);
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(file.data);
  });
}
