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
 * операций второй руки (SERVER.md §4): вместо прямой записи заводится запрос
 * `doc:grant-without-payment`, второй сотрудник с `doc:grant` подтверждает его
 * через общий `/api/second-hand/:id/confirm` (см. container.ts).
 */
export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/documents/grant', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const body = grantSchema.parse(req.body);
    try {
      await assertPermission(app.container.repos.auditLog, ctx.account, 'doc:grant', 'document:grant', body.code, body.tenantInn);
      await app.container.managerAssignments.assertTenantVisible(ctx.account, body.tenantInn);
    } catch (err) {
      if (err instanceof PermissionDeniedError) return reply.code(403).send({ ok: false, error: err.message });
      throw err;
    }
    if (ctx.account.side !== 'platform') {
      return reply.code(403).send({ ok: false, error: 'Выдаёт документ сотрудник платформы, а не клиника' });
    }
    if (!body.paid) {
      const secondHandRequest = await app.container.secondHand.request(
        'doc:grant-without-payment',
        { tenantInn: body.tenantInn, stage: body.stage, code: body.code, name: body.name },
        body.tenantInn,
        ctx.account.id,
      );
      return reply.send({ ok: true, secondHandRequest });
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
      await app.container.managerAssignments.assertTenantVisible(ctx.account, body.tenantInn);
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
