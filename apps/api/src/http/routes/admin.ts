import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isRole } from '@kontur785/shared';
import { requireAuth } from '../plugins/session.js';
import { assertPermission, PermissionDeniedError } from '../../rbac/service.js';

const approveSchema = z.object({ role: z.string() });
const elevateRequestSchema = z.object({ accountId: z.string(), newRole: z.string() });

/**
 * Администрирование учётных записей и «вторая рука» для повышения роли
 * (SERVER.md §4: "своей же рукой провести нельзя"). Остальные шесть операций
 * второй руки (публикация эталона/тарифов, удаление тарифа, массовая операция,
 * подтверждение крупной оплаты, выдача без оплаты) добавляются тем же способом —
 * `SecondHandService.request(...)` из соответствующего экрана — по мере переноса.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  async function requireRoleManage(req: FastifyRequest, reply: FastifyReply) {
    const ctx = requireAuth(req, reply);
    if (!ctx) return null;
    try {
      await assertPermission(app.container.repos.auditLog, ctx.account, 'role:manage', 'admin:role-manage', null, null);
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        reply.code(403).send({ ok: false, error: err.message });
        return null;
      }
      throw err;
    }
    return ctx;
  }

  app.get('/api/admin/accounts/pending', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    const pending = await app.container.auth.listPending();
    return reply.send({ ok: true, pending });
  });

  app.post('/api/admin/accounts/:id/approve', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { role } = approveSchema.parse(req.body);
    if (!isRole(role)) return reply.code(400).send({ ok: false, error: 'Неизвестная роль' });
    const r = await app.container.auth.approveAccount(id, role, ctx.account.id);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/admin/accounts/:id/reject', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const r = await app.container.auth.rejectAccount(id, ctx.account.id);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // Шаг 1 «второй руки»: запрос на повышение роли уже действующего сотрудника
  app.post('/api/admin/role-elevation/request', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    const body = elevateRequestSchema.parse(req.body);
    if (!isRole(body.newRole)) return reply.code(400).send({ ok: false, error: 'Неизвестная роль' });
    const request = await app.container.secondHand.request('role:elevate', { accountId: body.accountId, newRole: body.newRole }, null, ctx.account.id);
    return reply.send({ ok: true, request });
  });

}
