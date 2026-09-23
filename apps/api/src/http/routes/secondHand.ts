import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { can } from '@kontur785/shared';
import { requireAuth } from '../plugins/session.js';
import { assertPermission, PermissionDeniedError } from '../../rbac/service.js';
import { resolveConfirmPermission } from '../../container.js';

/**
 * Общее подтверждение/отклонение операции «второй руки» (SERVER.md §4) —
 * не привязано к конкретному экрану. Право подтверждающего и то, что
 * применяется при подтверждении, ищутся по типу запроса в
 * `container.secondHandHandlers` (см. container.ts) — так каждая новая
 * операция второй руки добавляется без правки этого файла.
 */
export async function secondHandRoutes(app: FastifyInstance): Promise<void> {
  // Панель: список открытых запросов с пометкой, может ли ТЕКУЩИЙ пользователь их подтвердить —
  // своей же рукой нельзя, и нужно право, соответствующее типу операции (SERVER.md §4).
  app.get('/api/second-hand/pending', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const items = await app.container.secondHand.listPending();
    const annotated = items.map((r) => {
      const handler = app.container.secondHandHandlers[r.type as keyof typeof app.container.secondHandHandlers];
      const canAct = !!handler && can(ctx.account.role, resolveConfirmPermission(handler, r.payload)) && r.requestedById !== ctx.account.id;
      return { ...r, canAct };
    });
    return reply.send({ ok: true, items: annotated });
  });

  app.post('/api/second-hand/:id/confirm', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);

    const request = await app.container.secondHand.get(id);
    if (!request) return reply.code(404).send({ ok: false, error: 'Запрос не найден' });
    const handler = app.container.secondHandHandlers[request.type as keyof typeof app.container.secondHandHandlers];
    if (!handler) return reply.code(400).send({ ok: false, error: 'Неизвестный тип операции второй руки' });

    try {
      await assertPermission(app.container.repos.auditLog, ctx.account, resolveConfirmPermission(handler, request.payload), 'second-hand:confirm', id, request.tenantInn);
    } catch (err) {
      if (err instanceof PermissionDeniedError) return reply.code(403).send({ ok: false, error: err.message });
      throw err;
    }

    const result = await app.container.secondHand.confirm(id, ctx.account.id, handler.apply);
    return reply.code(result.ok ? 200 : 400).send(result);
  });

  app.post('/api/second-hand/:id/reject', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);

    const request = await app.container.secondHand.get(id);
    if (!request) return reply.code(404).send({ ok: false, error: 'Запрос не найден' });
    const handler = app.container.secondHandHandlers[request.type as keyof typeof app.container.secondHandHandlers];
    if (!handler) return reply.code(400).send({ ok: false, error: 'Неизвестный тип операции второй руки' });

    try {
      await assertPermission(app.container.repos.auditLog, ctx.account, resolveConfirmPermission(handler, request.payload), 'second-hand:reject', id, request.tenantInn);
    } catch (err) {
      if (err instanceof PermissionDeniedError) return reply.code(403).send({ ok: false, error: err.message });
      throw err;
    }

    const result = await app.container.secondHand.reject(id, ctx.account.id);
    return reply.code(result.ok ? 200 : 400).send(result);
  });
}
