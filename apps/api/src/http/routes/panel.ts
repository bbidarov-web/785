import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../plugins/session.js';
import { PermissionDeniedError } from '../../rbac/service.js';

const checklistSchema = z.object({ name: z.string().min(1), items: z.array(z.string()) });
const stageDocSchema = z.object({ name: z.string().min(1), template: z.string() });
const stageBlockSchema = z.object({ key: z.string(), num: z.string(), name: z.string(), docs: z.array(stageDocSchema) });
const stageSchema = z.object({ code: z.number().int(), name: z.string(), price: z.number().nonnegative(), blocks: z.array(stageBlockSchema) });
const cycleSchema = z.object({
  year: z.number().int(),
  dirs: z.array(z.object({ name: z.string(), months: z.array(z.number().int().min(0).max(11)) })),
  capaTerms: z.array(z.object({ level: z.string(), days: z.number().int().positive() })),
});
const equipTypeSchema = z.object({
  key: z.string().min(1), name: z.string().min(1),
  logs: z.array(z.object({ name: z.string().min(1), freq: z.string().min(1), kind: z.enum(['журнал', 'чек-лист']) })),
});
const summaryRowSchema = z.object({ name: z.string().min(1), note: z.string().default(''), req: z.boolean().default(true) });

/**
 * Панель платформы — публикация эталонов методистом (README «Эталоны») и
 * подтверждение оплаты этапа (SERVER.md §5). Полная панель (дашборд, каталог
 * клиентов, подписки, очередь, тарифы) не перенесена — см. README «Известные
 * ограничения». Каталоги читает кто угодно авторизованный (это опубликованный
 * справочник продукта, не данные конкретной клиники), публикует — только
 * `standard:publish` (методист, администратор платформы).
 */
export async function panelRoutes(app: FastifyInstance): Promise<void> {
  function guarded<T>(fn: () => Promise<T>, reply: Parameters<typeof requireAuth>[1]) {
    return fn().catch((err) => {
      if (err instanceof PermissionDeniedError) {
        reply.code(403).send({ ok: false, error: err.message });
        return undefined;
      }
      throw err;
    });
  }

  app.get('/api/panel/checklists', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return reply.send({ ok: true, checklists: await app.container.catalog.getChecklists() });
  });

  app.put('/api/panel/checklists', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const checklists = z.array(checklistSchema).parse(req.body);
    const r = await guarded(() => app.container.catalog.publishChecklists(ctx.account, checklists), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 409).send(r);
  });

  app.get('/api/panel/stage-docs', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return reply.send({ ok: true, stages: await app.container.catalog.getStageDocs() });
  });

  app.put('/api/panel/stage-docs', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const stages = z.array(stageSchema).parse(req.body);
    const r = await guarded(() => app.container.catalog.publishStageDocs(ctx.account, stages), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 409).send(r);
  });

  app.get('/api/panel/cycle', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return reply.send({ ok: true, cycle: await app.container.catalog.getCycle() });
  });

  app.put('/api/panel/cycle', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const cycle = cycleSchema.parse(req.body);
    const r = await guarded(() => app.container.catalog.publishCycle(ctx.account, cycle), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 409).send(r);
  });

  app.post('/api/panel/stage-payments/:tenantInn/:code/confirm', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { tenantInn, code } = z.object({ tenantInn: z.string(), code: z.coerce.number().int() }).parse(req.params);
    const r = await guarded(() => app.container.payment.confirm(ctx.account, tenantInn, code), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.get('/api/panel/equip-types', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return reply.send({ ok: true, types: await app.container.catalog.getEquipTypes() });
  });

  app.put('/api/panel/equip-types', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const types = z.array(equipTypeSchema).parse(req.body);
    const r = await guarded(() => app.container.catalog.publishEquipTypes(ctx.account, types), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 409).send(r);
  });

  app.get('/api/panel/summary-master', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return reply.send({ ok: true, rows: await app.container.catalog.getSummaryMaster() });
  });

  app.put('/api/panel/summary-master', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const rows = z.array(summaryRowSchema).parse(req.body);
    const r = await guarded(() => app.container.catalog.publishSummaryMaster(ctx.account, rows), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 409).send(r);
  });

  app.get('/api/panel/clients', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const clients = await guarded(() => app.container.dashboard.listClients(ctx.account), reply);
    if (clients === undefined) return;
    return reply.send({ ok: true, clients });
  });
}
