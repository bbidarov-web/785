import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isRole } from '@kontur785/shared';
import { requireAuth } from '../plugins/session.js';
import { PermissionDeniedError } from '../../rbac/service.js';
import { toPublicAccount } from '../../auth/service.js';
import { renderDocx, renderPdf } from '../../documents/render.js';

const staffSchema = z.object({ fio: z.string().min(1), pos: z.string().default('') });
const assignSchema = z.object({ who: z.string() });
const planInputSchema = z.object({
  date: z.string(),
  dir: z.string(),
  object: z.string(),
  branch: z.string().optional(),
  who: z.string(),
  kind: z.enum(['плановая', 'внеплановая', 'целевая']),
  check: z.string().optional(),
});
const planPatchSchema = planInputSchema.partial();
const capaCreateSchema = z.object({ planId: z.string(), itemIndex: z.number().int().min(0), due: z.string().optional(), who: z.string().optional(), severity: z.string().optional() });
const capaStatusSchema = z.object({ status: z.enum(['planned', 'done']) });
const capaEffectivenessSchema = z.object({ effective: z.boolean(), comment: z.string().optional() });

/**
 * Личный кабинет ВКК — первая часть (README «Сотрудники и матрица
 * ответственных», «План проверок», «Нарушения и CAPA»). Полный экран не
 * перенесён — см. apps/api/src/clinic/*.ts и README «Известные ограничения».
 */
export async function clinicRoutes(app: FastifyInstance): Promise<void> {
  function guarded<T>(fn: () => Promise<T>, reply: Parameters<typeof requireAuth>[1]) {
    return fn().catch((err) => {
      if (err instanceof PermissionDeniedError) {
        reply.code(403).send({ ok: false, error: err.message });
        return undefined;
      }
      throw err;
    });
  }

  app.get('/api/clinic/staff', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const staff = await guarded(() => app.container.staff.list(ctx.account), reply);
    if (staff === undefined) return;
    return reply.send({ ok: true, staff });
  });

  app.post('/api/clinic/staff', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const body = staffSchema.parse(req.body);
    const r = await guarded(() => app.container.staff.upsert(ctx.account, body), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.delete('/api/clinic/staff/:fio', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { fio } = z.object({ fio: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.staff.remove(ctx.account, decodeURIComponent(fio)), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // Заявки на доступ к клинике (README «Доступы и роли») — закрывает саморегистрацию
  // незнакомца в чужую клинику по публичному ИНН (auth/service.ts register()):
  // заявка появляется здесь, только администратор клиники может её подтвердить/отклонить.
  app.get('/api/clinic/accounts/pending', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const pending = await guarded(() => app.container.auth.listPendingForClinic(ctx.account), reply);
    if (pending === undefined) return;
    return reply.send({ ok: true, pending: pending.map(toPublicAccount) });
  });

  app.get('/api/clinic/accounts', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const accounts = await guarded(() => app.container.auth.listClinicAccounts(ctx.account), reply);
    if (accounts === undefined) return;
    return reply.send({ ok: true, accounts: accounts.map(toPublicAccount) });
  });

  app.get('/api/clinic/invites', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const invites = await guarded(() => app.container.auth.invites.list(ctx.account), reply);
    if (invites === undefined) return;
    return reply.send({ ok: true, invites });
  });

  app.post('/api/clinic/invites', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { role, branchName } = z.object({ role: z.string(), branchName: z.string().nullable().optional() }).parse(req.body);
    if (!isRole(role)) return reply.code(400).send({ ok: false, error: 'Неизвестная роль' });
    const r = await guarded(() => app.container.auth.invites.create(ctx.account, role, branchName ?? null), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.delete('/api/clinic/invites/:id', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.auth.invites.revoke(ctx.account, id), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/clinic/accounts/:id/approve', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { role, branchName } = z.object({ role: z.string(), branchName: z.string().optional() }).parse(req.body);
    if (!isRole(role)) return reply.code(400).send({ ok: false, error: 'Неизвестная роль' });
    const r = await guarded(() => app.container.auth.approveClinicAccount(ctx.account, id, role, branchName), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/clinic/accounts/:id/reject', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.auth.rejectClinicAccount(ctx.account, id), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // Закрепление уже активного сотрудника за филиалом (README «Объекты как первый класс») —
  // ограничивает видимость плана и оборудования; null снимает ограничение.
  app.put('/api/clinic/accounts/:id/branch', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { branchName } = z.object({ branchName: z.string().nullable() }).parse(req.body);
    const r = await guarded(() => app.container.auth.setAccountBranch(ctx.account, id, branchName), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.get('/api/clinic/assignments', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const assignments = await guarded(() => app.container.staff.listAssignments(ctx.account), reply);
    if (assignments === undefined) return;
    const progress = await guarded(() => app.container.staff.listDocProgress(ctx.account), reply);
    if (progress === undefined) return;
    return reply.send({ ok: true, assignments, progress });
  });

  app.put('/api/clinic/assignments/:code', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { code } = z.object({ code: z.string() }).parse(req.params);
    const { who } = assignSchema.parse(req.body);
    const r = await guarded(() => app.container.staff.setAssignment(ctx.account, decodeURIComponent(code), who), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.get('/api/clinic/plan', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const plan = await guarded(() => app.container.plan.list(ctx.account), reply);
    if (plan === undefined) return;
    return reply.send({ ok: true, plan });
  });

  app.post('/api/clinic/plan', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const body = planInputSchema.parse(req.body);
    const r = await guarded(() => app.container.plan.create(ctx.account, body), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.put('/api/clinic/plan/:id', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const patch = planPatchSchema.parse(req.body);
    const r = await guarded(() => app.container.plan.update(ctx.account, id, patch), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.delete('/api/clinic/plan/:id', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.plan.remove(ctx.account, id), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.get('/api/clinic/capa', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const items = await guarded(() => app.container.capa.list(ctx.account), reply);
    if (items === undefined) return;
    return reply.send({ ok: true, items });
  });

  app.get('/api/clinic/capa/findings', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const findings = await guarded(() => app.container.capa.listOpenFindings(ctx.account), reply);
    if (findings === undefined) return;
    return reply.send({ ok: true, findings });
  });

  app.post('/api/clinic/capa', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const body = capaCreateSchema.parse(req.body);
    const r = await guarded(() => app.container.capa.createFromFinding(ctx.account, body.planId, body.itemIndex, { due: body.due, who: body.who, severity: body.severity }), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.put('/api/clinic/capa/:id/status', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { status } = capaStatusSchema.parse(req.body);
    const r = await guarded(() => app.container.capa.updateStatus(ctx.account, id, status), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.put('/api/clinic/capa/:id/effectiveness', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { effective, comment } = capaEffectivenessSchema.parse(req.body);
    const r = await guarded(() => app.container.capa.checkEffectiveness(ctx.account, id, effective, comment ?? ''), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.get('/api/clinic/stages', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const stages = await guarded(() => app.container.stage.getClinicView(ctx.account), reply);
    if (stages === undefined) return;
    return reply.send({ ok: true, stages });
  });

  app.post('/api/clinic/stages/:code/request-payment', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { code } = z.object({ code: z.coerce.number().int() }).parse(req.params);
    const r = await guarded(() => app.container.stage.requestPayment(ctx.account, code), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/clinic/stages/:code/accept-offer', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { code } = z.object({ code: z.coerce.number().int() }).parse(req.params);
    const r = await guarded(() => app.container.stage.acceptOffer(ctx.account, code), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // Акты обходов (номер присваивается при завершении обхода, WalkService.finish)
  app.get('/api/clinic/acts', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const acts = await guarded(() => app.container.walk.listActs(ctx.account), reply);
    if (acts === undefined) return;
    return reply.send({ ok: true, acts });
  });

  app.get('/api/clinic/acts/:planId/pdf', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { planId } = z.object({ planId: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.walk.getActText(ctx.account, planId), reply);
    if (r === undefined) return;
    if (!r.ok) return reply.code(400).send(r);
    const buf = await renderPdf(r.title, r.body);
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="act-${encodeURIComponent(planId)}.pdf"`).send(buf);
  });

  app.get('/api/clinic/documents/:name/content', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.stage.getDocumentContent(ctx.account, decodeURIComponent(name)), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // Тот же контент, что «/content», но упакованный в файл (README «Файлы и
  // электронная подпись») — те же проверки выдачи/оплаты, просто другой формат ответа.
  app.get('/api/clinic/documents/:name/docx', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { name: rawName } = z.object({ name: z.string() }).parse(req.params);
    const name = decodeURIComponent(rawName);
    const r = await guarded(() => app.container.stage.getDocumentContent(ctx.account, name), reply);
    if (r === undefined) return;
    if (!r.ok) return reply.code(400).send(r);
    const buf = await renderDocx(name, r.content);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}.docx"`)
      .send(buf);
  });

  app.get('/api/clinic/documents/:name/pdf', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { name: rawName } = z.object({ name: z.string() }).parse(req.params);
    const name = decodeURIComponent(rawName);
    const r = await guarded(() => app.container.stage.getDocumentContent(ctx.account, name), reply);
    if (r === undefined) return;
    if (!r.ok) return reply.code(400).send(r);
    const buf = await renderPdf(name, r.content);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}.pdf"`)
      .send(buf);
  });
}
