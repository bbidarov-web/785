import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../plugins/session.js';
import { assertPermission, assertTenantScope, PermissionDeniedError } from '../../rbac/service.js';
import { SECOND_SUM } from '@kontur785/shared';

const grantSchema = z.object({ tenantInn: z.string(), stage: z.string(), code: z.string(), name: z.string(), paid: z.boolean() });
const revokeSchema = z.object({ tenantInn: z.string(), stage: z.string(), code: z.string(), name: z.string() });

/**
 * Выдача документов (README "Выдача документов", SERVER.md §5): оплата этапа
 * открывает состав, но выдаёт документ ЧЕЛОВЕК — методист, менеджер по своей
 * клинике или администратор. Выдача без оплаты (`paid=false`) — одна из семи
 * операций второй руки (SERVER.md §4) и в этом эндпоинте пока прямая: перевод
 * на SecondHandService — следующий шаг при переносе экрана "Карточка клиники".
 */
export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/documents/grant', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const body = grantSchema.parse(req.body);
    try {
      await assertPermission(app.container.repos.auditLog, ctx.account, 'doc:grant', 'document:grant', body.code, body.tenantInn);
    } catch (err) {
      if (err instanceof PermissionDeniedError) return reply.code(403).send({ ok: false, error: err.message });
      throw err;
    }
    if (ctx.account.side !== 'platform') {
      return reply.code(403).send({ ok: false, error: 'Выдаёт документ сотрудник платформы, а не клиника' });
    }
    if (!body.paid) {
      return reply.code(409).send({
        ok: false,
        error: 'Выдача без оплаты требует подтверждения вторым сотрудником — оформите через /api/second-hand/request (type=doc:grant-without-payment)',
      });
    }
    const row = await app.container.documents.grant(body.tenantInn, body.stage, body.code, body.name, ctx.account, true);
    return reply.send({ ok: true, grant: row });
  });

  app.post('/api/documents/revoke', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const body = revokeSchema.parse(req.body);
    try {
      await assertPermission(app.container.repos.auditLog, ctx.account, 'doc:grant', 'document:revoke', body.code, body.tenantInn);
    } catch (err) {
      if (err instanceof PermissionDeniedError) return reply.code(403).send({ ok: false, error: err.message });
      throw err;
    }
    const row = await app.container.documents.revoke(body.tenantInn, body.stage, body.code, body.name, ctx.account);
    return reply.send({ ok: true, grant: row });
  });

  app.get('/api/tenants/:inn/documents/grants', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { inn } = z.object({ inn: z.string() }).parse(req.params);
    try {
      if (ctx.account.side === 'clinic') assertTenantScope(ctx.account, inn);
      else await assertPermission(app.container.repos.auditLog, ctx.account, 'clinic:read', 'document:list-grants', inn, inn);
    } catch (err) {
      if (err instanceof PermissionDeniedError) return reply.code(403).send({ ok: false, error: err.message });
      throw err;
    }
    const grants = await app.container.documents.listActiveGrants(inn);
    return reply.send({ ok: true, grants });
  });

  // порог "вторая рука" при подтверждении оплаты — используется экраном оплаты при его переносе
  app.get('/api/config/second-hand-thresholds', async (_req, reply) => {
    return reply.send({ ok: true, secondSum: SECOND_SUM });
  });
}
