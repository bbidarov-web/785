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
const tariffSchema = z.object({
  key: z.string().min(1), name: z.string().min(1), price: z.number().nonnegative(),
  period: z.enum(['monthly', 'annual']), description: z.string().default(''), active: z.boolean(),
});
const bulkTenantInnsSchema = z.object({ tenantInns: z.array(z.string()).min(1) });

/**
 * Панель платформы — публикация эталонов методистом (README «Эталоны»),
 * подтверждение и приёмка оплаты этапа (SERVER.md §5), тарифы и подписки
 * клиник, массовые операции по каталогу клиентов с откатом. Каталоги читает
 * кто угодно авторизованный (это опубликованный справочник продукта, не
 * данные конкретной клиники), публикует — только `standard:publish`
 * (методист, администратор платформы), через вторую руку (SERVER.md §4).
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

  app.post('/api/panel/stage-payments/:tenantInn/:code/accept', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { tenantInn, code } = z.object({ tenantInn: z.string(), code: z.coerce.number().int() }).parse(req.params);
    const r = await guarded(() => app.container.stage.acceptStage(ctx.account, tenantInn, code), reply);
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

  app.get('/api/panel/financials', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const financials = await guarded(() => app.container.dashboard.getFinancials(ctx.account), reply);
    if (financials === undefined) return;
    return reply.send({ ok: true, financials });
  });

  // ───────── Тарифы и продукты (README «Дашборд»; SERVER.md §4 — публикация/удаление второй рукой) ─────────

  app.get('/api/panel/tariffs', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return reply.send({ ok: true, tariffs: await app.container.tariff.getTariffs() });
  });

  app.put('/api/panel/tariffs', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const tariffs = z.array(tariffSchema).parse(req.body);
    const r = await guarded(() => app.container.tariff.saveDraft(ctx.account, tariffs), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/panel/tariffs/:key/publish', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { key } = z.object({ key: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.tariff.requestPublish(ctx.account, key), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/panel/tariffs/:key/delete', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { key } = z.object({ key: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.tariff.requestDelete(ctx.account, key), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // ───────── Подписки клиник (README «Дашборд»: подписки, срок жизни, отток) ─────────

  app.get('/api/panel/subscriptions', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const rows = await guarded(() => app.container.subscription.listAll(ctx.account), reply);
    if (rows === undefined) return;
    return reply.send({ ok: true, subscriptions: rows });
  });

  app.post('/api/panel/subscriptions/:tenantInn/assign', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { tenantInn } = z.object({ tenantInn: z.string() }).parse(req.params);
    const body = z.object({ tariffKey: z.string().min(1), days: z.number().int().positive(), trial: z.boolean().default(false) }).parse(req.body);
    const r = await guarded(() => app.container.subscription.assign(ctx.account, tenantInn, body.tariffKey, body.days, body.trial), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/panel/subscriptions/:tenantInn/renew', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { tenantInn } = z.object({ tenantInn: z.string() }).parse(req.params);
    const body = z.object({ days: z.number().int().positive().default(30) }).parse(req.body ?? {});
    const r = await guarded(() => app.container.subscription.renew(ctx.account, tenantInn, body.days), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/panel/subscriptions/:tenantInn/cancel', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { tenantInn } = z.object({ tenantInn: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.subscription.cancel(ctx.account, tenantInn), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // ───────── Массовые операции по каталогу клиентов (README «Дашборд»; прототип — bulkPrepare/bulkCommit) ─────────

  app.post('/api/panel/bulk/:action/prepare', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { action } = z.object({ action: z.string() }).parse(req.params);
    const { tenantInns } = bulkTenantInnsSchema.parse(req.body);
    const r = await guarded(() => app.container.bulk.prepare(ctx.account, action, tenantInns), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/panel/bulk/:action/commit', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { action } = z.object({ action: z.string() }).parse(req.params);
    const { tenantInns } = bulkTenantInnsSchema.parse(req.body);
    const r = await guarded(() => app.container.bulk.commit(ctx.account, action, tenantInns), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.get('/api/panel/bulk/reports', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const reports = await guarded(() => app.container.bulk.listReports(ctx.account), reply);
    if (reports === undefined) return;
    return reply.send({ ok: true, reports });
  });

  app.post('/api/panel/bulk/reports/:id/undo', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.bulk.undo(ctx.account, id), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });
}
