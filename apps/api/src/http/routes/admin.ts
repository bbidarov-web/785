import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isRole } from '@kontur785/shared';
import { requireAuth } from '../plugins/session.js';
import { assertPermission, PermissionDeniedError } from '../../rbac/service.js';
import { toPublicAccount } from '../../auth/service.js';

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

  // Сети клиник: заводит администратор платформы, свой стандарт ведёт головная клиника (routes/clinic.ts).
  app.get('/api/admin/networks', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    return reply.send({ ok: true, networks: await app.container.network.listAll(ctx.account) });
  });

  app.post('/api/admin/networks', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    const { name, headInn } = z.object({ name: z.string(), headInn: z.string() }).parse(req.body);
    const r = await app.container.network.create(ctx.account, name, headInn);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/admin/networks/:id/members', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { inn } = z.object({ inn: z.string() }).parse(req.body);
    const r = await app.container.network.addMember(ctx.account, id, inn);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.delete('/api/admin/networks/:id/members/:inn', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    const { id, inn } = z.object({ id: z.string(), inn: z.string() }).parse(req.params);
    const r = await app.container.network.removeMember(ctx.account, id, inn);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.delete('/api/admin/networks/:id', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const r = await app.container.network.remove(ctx.account, id);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // «Ответственный менеджер» — закрепление sales_manager за конкретными клиниками (panel/managerAssignments.ts).
  app.get('/api/admin/manager-assignments', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    return reply.send({ ok: true, assignments: await app.container.managerAssignments.list(ctx.account) });
  });

  app.put('/api/admin/manager-assignments/:managerId', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    const { managerId } = z.object({ managerId: z.string() }).parse(req.params);
    const { inns } = z.object({ inns: z.array(z.string()) }).parse(req.body);
    const r = await app.container.managerAssignments.setForManager(ctx.account, managerId, inns);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.get('/api/admin/accounts/pending', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    const pending = await app.container.auth.listPending();
    return reply.send({ ok: true, pending: pending.map(toPublicAccount) });
  });

  app.get('/api/admin/accounts', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    const accounts = await app.container.auth.listPlatformStaff(ctx.account);
    return reply.send({ ok: true, accounts: accounts.map(toPublicAccount) });
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

  // Проверка целостности журнала действий (audit/chain.ts) — обнаруживает
  // правку/удаление записи в обход интерфейса, в том числе задним числом.
  app.get('/api/admin/audit-log/verify', async (req, reply) => {
    const ctx = await requireRoleManage(req, reply);
    if (!ctx) return;
    const result = await app.container.repos.auditLog.verifyChain();
    return reply.send(result);
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
