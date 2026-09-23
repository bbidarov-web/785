import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../plugins/session.js';
import { PermissionDeniedError } from '../../rbac/service.js';

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
const capaCreateSchema = z.object({ planId: z.string(), itemIndex: z.number().int().min(0), due: z.string().optional(), who: z.string().optional() });
const capaStatusSchema = z.object({ status: z.enum(['planned', 'done']) });

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

  app.get('/api/clinic/assignments', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const assignments = await guarded(() => app.container.staff.listAssignments(ctx.account), reply);
    if (assignments === undefined) return;
    return reply.send({ ok: true, assignments });
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
    const r = await guarded(() => app.container.capa.createFromFinding(ctx.account, body.planId, body.itemIndex, { due: body.due, who: body.who }), reply);
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

  app.get('/api/clinic/documents/:name/content', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.stage.getDocumentContent(ctx.account, decodeURIComponent(name)), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });
}
