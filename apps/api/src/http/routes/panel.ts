import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../plugins/session.js';
import { assertPermission, PermissionDeniedError } from '../../rbac/service.js';

const checklistSchema = z.object({ name: z.string().min(1), items: z.array(z.string()) });
const stageDocSchema = z.object({ name: z.string().min(1), template: z.string() });
const stageBlockSchema = z.object({ key: z.string(), num: z.string(), name: z.string(), docs: z.array(stageDocSchema) });
const stageSchema = z.object({
  code: z.number().int(), name: z.string(), price: z.number().nonnegative(),
  offerText: z.string().optional(), offerFile: z.string().optional(),
  blocks: z.array(stageBlockSchema),
});
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
const addClinicSchema = z.object({
  inn: z.string(), org: z.string().min(1), login: z.string().min(3),
  password: z.string(), password2: z.string(), fio: z.string().min(1),
});
const digestSettingsSchema = z.object({ recipientEmail: z.string(), schedule: z.string().min(1) });

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

  app.get('/api/panel/portfolio', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { days } = z.object({ days: z.coerce.number().int().positive().default(30) }).parse(req.query);
    const portfolio = await guarded(() => app.container.dashboard.getPortfolio(ctx.account, days), reply);
    if (portfolio === undefined) return;
    return reply.send({ ok: true, portfolio });
  });

  app.get('/api/panel/clients/export', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const csv = await guarded(() => app.container.dashboard.exportClientsCsv(ctx.account), reply);
    if (csv === undefined) return;
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="clients.csv"');
    return reply.send('﻿' + csv);
  });

  /** «+ Добавить клинику» (README «Панель платформы») — платформа заводит клинику и её администратора напрямую, минуя саморегистрацию. */
  app.post('/api/panel/clients', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    try {
      await assertPermission(app.container.repos.auditLog, ctx.account, 'sub:write', 'panel:add-clinic', null, null);
    } catch (err) {
      if (err instanceof PermissionDeniedError) return reply.code(403).send({ ok: false, error: err.message });
      throw err;
    }
    const body = addClinicSchema.parse(req.body);
    const r = await app.container.auth.register({
      inn: body.inn, login: body.login, password: body.password, password2: body.password2,
      org: body.org, fio: body.fio, side: 'clinic',
    });
    if (!r.ok) return reply.code(400).send(r);
    await app.container.repos.auditLog.append({
      actorId: ctx.account.id, actorRole: ctx.account.role, tenantInn: r.account.inn,
      action: 'panel:add-clinic', target: r.account.id, meta: { org: body.org }, allowed: true,
    });
    return reply.send({ ok: true, account: r.account });
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

  app.get('/api/panel/subscriptions/summary', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const summary = await guarded(() => app.container.subscription.getSummary(ctx.account), reply);
    if (summary === undefined) return;
    return reply.send({ ok: true, summary });
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

  // Пачка больше SECOND_BULK клиник после подтверждения второй рукой применяется
  // в фоне (README «Что дальше» → закрыто) — панель опрашивает прогресс здесь.
  app.get('/api/panel/bulk/jobs/:id', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const job = await guarded(() => app.container.bulk.getJob(ctx.account, id), reply);
    if (job === undefined) return;
    if (!job) return reply.code(404).send({ ok: false, error: 'Задача не найдена' });
    return reply.send({ ok: true, job });
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

  // ───────── Очередь работы (README «Очередь работы»; прототип — Админ-панель.dc.html) ─────────

  app.get('/api/panel/queue', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const tasks = await guarded(() => app.container.queue.list(ctx.account), reply);
    if (tasks === undefined) return;
    return reply.send({ ok: true, tasks });
  });

  app.post('/api/panel/queue/:id/take', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.queue.take(ctx.account, id), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/panel/queue/:id/postpone', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.queue.postpone(ctx.account, id), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/panel/queue/:id/close', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.queue.close(ctx.account, id), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.get('/api/panel/queue/digest-settings', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const settings = await guarded(() => app.container.queue.getDigestSettings(ctx.account), reply);
    if (settings === undefined) return;
    return reply.send({ ok: true, settings });
  });

  app.put('/api/panel/queue/digest-settings', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const body = digestSettingsSchema.parse(req.body);
    const r = await guarded(() => app.container.queue.saveDigestSettings(ctx.account, body), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/panel/queue/digest/send', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const r = await guarded(() => app.container.queue.sendDigestNow(ctx.account), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });
}
