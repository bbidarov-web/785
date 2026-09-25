import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../plugins/session.js';
import { PermissionDeniedError } from '../../rbac/service.js';
import { renderPdf } from '../../documents/render.js';

const branchNameSchema = z.object({ name: z.string().min(1) });
const cyclePatchSchema = z.object({
  months: z.array(z.number().int().min(0).max(11)).optional(),
  check: z.string().optional(),
  object: z.string().optional(),
  branch: z.string().optional(),
  who: z.string().optional(),
});
const equipPositionSchema = z.object({
  uid: z.string().optional(),
  name: z.string().min(1),
  room: z.string().optional(),
  branch: z.string().optional(),
  type: z.string().optional(),
  logWho: z.record(z.string(), z.string()).optional(),
});
const equipFillSchema = z.object({
  value: z.string().optional(),
  note: z.string().optional(),
  answers: z.record(z.string(), z.enum(['ok', 'bad'])).optional(),
  source: z.enum(['обход', 'кабинет клиники']).default('кабинет клиники'),
});
const summaryUploadSchema = z.object({ fileName: z.string().min(1), base64: z.string().min(1) });
const profileSchema = z.object({ orgFull: z.string(), orgShort: z.string(), license: z.string(), chiefDoctor: z.string(), city: z.string() });
const selfAuditAnswerSchema = z.object({ index: z.number().int().min(0), answer: z.enum(['', 'ok', 'bad', 'na']), comment: z.string().default('') });

/**
 * Продолжение Личного кабинета ВКК: филиалы, годовой цикл, оборудование,
 * сводный отчёт, самообследование (README «Что дальше»). Вынесено из
 * `clinic.ts` отдельным файлом — тот и так покрывает штат/план/CAPA/этапы.
 */
export async function clinicExtraRoutes(app: FastifyInstance): Promise<void> {
  function guarded<T>(fn: () => Promise<T>, reply: Parameters<typeof requireAuth>[1]) {
    return fn().catch((err) => {
      if (err instanceof PermissionDeniedError) {
        reply.code(403).send({ ok: false, error: err.message });
        return undefined;
      }
      throw err;
    });
  }

  // --- Реквизиты клиники ---
  app.get('/api/clinic/profile', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const profile = await guarded(() => app.container.profile.get(ctx.account), reply);
    if (profile === undefined) return;
    return reply.send({ ok: true, profile });
  });

  app.put('/api/clinic/profile', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const body = profileSchema.parse(req.body);
    const r = await guarded(() => app.container.profile.save(ctx.account, body), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // --- Опись документов ---
  app.get('/api/clinic/documents/inventory', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const inventory = await guarded(() => app.container.inventory.getInventory(ctx.account), reply);
    if (inventory === undefined) return;
    return reply.send({ ok: true, ...inventory });
  });

  // Печать описи (README «Файлы и электронная подпись» → «печать описи документов») —
  // тот же контрольный лист, что и JSON-версия выше, в файле для инспектора.
  app.get('/api/clinic/documents/inventory/pdf', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const inventory = await guarded(() => app.container.inventory.getInventory(ctx.account), reply);
    if (inventory === undefined) return;
    const lines = inventory.rows.map((r) => `[${r.filled ? 'x' : ' '}] ${r.zone} · ${r.name}${r.filledAt ? ` — ${r.filledLabel} ${r.filledAt}` : r.required ? ' — не заполнено' : ''}`);
    const body = [
      `Заполнено: ${inventory.summary.filled} из ${inventory.summary.total}`,
      '',
      ...lines,
    ].join('\n');
    const buf = await renderPdf(`Опись документов · ИНН ${ctx.account.inn}`, body);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="opis-${ctx.account.inn}.pdf"`)
      .send(buf);
  });

  // --- Филиалы ---
  app.get('/api/clinic/branches', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const branches = await guarded(() => app.container.branch.list(ctx.account), reply);
    if (branches === undefined) return;
    return reply.send({ ok: true, branches });
  });

  app.post('/api/clinic/branches', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { name } = branchNameSchema.parse(req.body);
    const r = await guarded(() => app.container.branch.upsert(ctx.account, name), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.delete('/api/clinic/branches/:id', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.branch.remove(ctx.account, id), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // --- Годовой цикл ---
  app.get('/api/clinic/cycle', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const r = await guarded(() => app.container.cycle.getMergedView(ctx.account), reply);
    if (r === undefined) return;
    // «ещё не опубликован методистом» — штатное состояние, не ошибка запроса (400 засорял консоль каждой загрузки кабинета)
    return reply.send(r);
  });

  app.put('/api/clinic/cycle/:name', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const patch = cyclePatchSchema.parse(req.body);
    const r = await guarded(() => app.container.cycle.customizeDirection(ctx.account, decodeURIComponent(name), patch), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/clinic/cycle/generate', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const r = await guarded(() => app.container.cycle.generatePlan(ctx.account), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // --- Оборудование ---
  app.get('/api/clinic/equipment/positions', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const positions = await guarded(() => app.container.equipment.listPositions(ctx.account), reply);
    if (positions === undefined) return;
    return reply.send({ ok: true, positions });
  });

  app.post('/api/clinic/equipment/positions', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const body = equipPositionSchema.parse(req.body);
    const r = await guarded(() => app.container.equipment.upsertPosition(ctx.account, body), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.delete('/api/clinic/equipment/positions/:uid', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { uid } = z.object({ uid: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.equipment.removePosition(ctx.account, uid), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.get('/api/clinic/equipment/forms', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const forms = await guarded(() => app.container.equipment.listForms(ctx.account), reply);
    if (forms === undefined) return;
    return reply.send({ ok: true, forms });
  });

  app.post('/api/clinic/equipment/positions/:uid/forms/:form/fill', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { uid, form } = z.object({ uid: z.string(), form: z.string() }).parse(req.params);
    const body = equipFillSchema.parse(req.body);
    const r = await guarded(() => app.container.equipment.fillForm(ctx.account, uid, decodeURIComponent(form), body, body.source), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // --- Сводный отчёт ---
  app.get('/api/clinic/summary', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const rows = await guarded(() => app.container.summary.getView(ctx.account), reply);
    if (rows === undefined) return;
    return reply.send({ ok: true, rows });
  });

  app.post('/api/clinic/summary/:name/upload', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const { fileName, base64 } = summaryUploadSchema.parse(req.body);
    const r = await guarded(() => app.container.summary.uploadFile(ctx.account, decodeURIComponent(name), fileName, base64), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.delete('/api/clinic/summary/:name', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.summary.removeFile(ctx.account, decodeURIComponent(name)), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // --- Самообследование ---
  app.get('/api/clinic/selfaudit', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const runs = await guarded(() => app.container.selfAudit.listRuns(ctx.account), reply);
    if (runs === undefined) return;
    return reply.send({ ok: true, runs });
  });

  app.post('/api/clinic/selfaudit/:checklist/start', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { checklist } = z.object({ checklist: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.selfAudit.start(ctx.account, decodeURIComponent(checklist)), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/clinic/selfaudit/:checklist/answer', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { checklist } = z.object({ checklist: z.string() }).parse(req.params);
    const body = selfAuditAnswerSchema.parse(req.body);
    const r = await guarded(() => app.container.selfAudit.answer(ctx.account, decodeURIComponent(checklist), body.index, body.answer, body.comment), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/clinic/selfaudit/:checklist/finish', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { checklist } = z.object({ checklist: z.string() }).parse(req.params);
    const r = await guarded(() => app.container.selfAudit.finish(ctx.account, decodeURIComponent(checklist)), reply);
    if (r === undefined) return;
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.get('/api/clinic/selfaudit/export', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const r = await guarded(() => app.container.selfAudit.exportPackage(ctx.account), reply);
    if (r === undefined) return;
    if (!r.ok) return reply.code(400).send(r);
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="selfaudit-${ctx.account.inn}.txt"`);
    return reply.send(r.text);
  });
}
