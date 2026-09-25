import { randomUUID } from 'node:crypto';
import { SECOND_BULK, type Permission } from '@kontur785/shared';
import type { Repos } from '../domain/ports.js';
import type { Account, SecondHandRequest } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { SecondHandService } from '../secondHand/service.js';
import { todayString } from '../shared/date.js';

export type BulkResult<T> = { ok: true } & T | { ok: false; error: string };

export interface BulkCheckResult {
  ok: boolean;
  why?: string;
  preview?: string;
}

/**
 * Одна массовая операция реестра (`BULK_ACTIONS` в container.ts) — по духу
 * тот же паттерн, что `secondHandHandlers`: добавить новую операцию — это
 * новая запись реестра, не правка движка. `kind` решает, каким правом
 * подтверждается пачка больше `SECOND_BULK` клиник: методологические операции
 * (эталон, годовой цикл, проверки) — `second:standard`, денежные (тарифы,
 * подписки) — `second:money` (reference/prototype/Админ-панель.dc.html,
 * `bulkCommit`: `/цикл|проверк|эталон/i.test(label) ? 'standard' : 'money'`).
 */
export interface BulkActionDef {
  label: string;
  requestPermission: Permission;
  kind: 'standard' | 'money';
  undoable: boolean;
  /** Тенантский канал, который трогает `apply` — для снимка/отката; `null`, если операция не меняет данные (например, напоминание). */
  channelKey: (tenantInn: string) => string | null;
  check: (repos: Repos, tenantInn: string) => Promise<BulkCheckResult>;
  apply: (repos: Repos, tenantInn: string, byId: string) => Promise<void>;
}

export interface BulkPreviewRow {
  inn: string;
  name: string;
  ok: boolean;
  why: string;
  preview: string;
}

interface BulkSnapshotEntry {
  tenantInn: string;
  key: string;
  data: unknown;
  version: number;
}

export interface BulkReport {
  id: string;
  actionKey: string;
  label: string;
  at: string;
  byId: string;
  done: { inn: string; name: string }[];
  skipped: { inn: string; name: string; why: string }[];
  failed: { inn: string; name: string; why: string }[];
  undoable: boolean;
  undoneAt: string | null;
  snapshot: BulkSnapshotEntry[];
}

const REPORTS_KEY = 'bulk_reports';
const MAX_REPORTS = 50;

export type BulkJobStatus = 'running' | 'done' | 'failed';

/**
 * Состояние фоновой пачки (README «Что дальше» → «фоновые массовые операции»,
 * закрыто): подтверждение второй рукой заводит задачу и возвращается сразу —
 * пачка на сотни клиник не должна держать открытым HTTP-запрос подтверждения
 * (и тем более не должна зависеть от того, не закрыл ли кто-то вкладку).
 * Двойного применения не будет, даже если запрос подтверждения продублируется:
 * `SecondHandService.confirm` переводит pending → confirmed атомарно (CAS) ДО
 * вызова apply(), так что до второго `runInBackground` дело просто не дойдёт.
 */
export interface BulkJob {
  id: string;
  actionKey: string;
  status: BulkJobStatus;
  total: number;
  doneCount: number;
  startedAt: string;
  finishedAt: string | null;
  reportId: string | null;
  error: string | null;
}

const JOBS_KEY = 'bulk_jobs';
const QUOTA_KEY = 'bulk_actor_quota';
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_JOBS = 50;

/**
 * Массовые операции по каталогу клиентов (README «Дашборд»; прототип —
 * `bulkPrepare`/`bulkCommit`/`bulkUndo`, три контура защиты данных):
 * 1) preflight — каждая клиника проверяется ДО записи, непригодные отсеиваются;
 * 2) снимок затрагиваемых каналов — операцию можно откатить целиком;
 * 3) отчёт по каждой клинике — где применилось, где пропущено и почему.
 * Пачка больше `SECOND_BULK` (20) клиник — операция второй руки (`bulk:clinics`,
 * SERVER.md §4): вместо прямого применения заводится запрос, второй сотрудник
 * подтверждает его через общий `/api/second-hand/:id/confirm`.
 */
export class BulkOperationService {
  constructor(
    private repos: Repos,
    private secondHand: SecondHandService,
    private registry: Record<string, BulkActionDef>,
  ) {}

  private async previewRows(def: BulkActionDef, tenantInns: string[]): Promise<{ rows: BulkPreviewRow[]; nameByInn: Map<string, string> }> {
    const tenants = await this.repos.tenants.listAll();
    const nameByInn = new Map(tenants.map((t) => [t.inn, t.name]));
    // Проверки независимы по клинике — параллелим, а не ждём каждую по
    // очереди (было бы N последовательных round-trip на предпросмотр пачки).
    const rows = await Promise.all(tenantInns.map(async (inn) => {
      const name = nameByInn.get(inn) ?? inn;
      let result: BulkCheckResult;
      try {
        result = await def.check(this.repos, inn);
      } catch {
        result = { ok: false, why: 'ошибка проверки' };
      }
      return { inn, name, ok: !!result.ok, why: result.why ?? '', preview: result.preview ?? '' };
    }));
    return { rows, nameByInn };
  }

  /** Предпросмотр без записи (README «предпроверка») — что применится, что пропустится и почему. */
  async prepare(account: Account, actionKey: string, tenantInns: string[]): Promise<BulkResult<{ label: string; undoable: boolean; rows: BulkPreviewRow[] }>> {
    const def = this.registry[actionKey];
    if (!def) return { ok: false, error: 'Неизвестная массовая операция' };
    await assertPermission(this.repos.auditLog, account, def.requestPermission, `bulk:${actionKey}:prepare`, null, null);
    const uniqueInns = [...new Set(tenantInns)];
    if (!uniqueInns.length) return { ok: false, error: 'Сначала отметьте клиники — галочкой в списке' };
    const { rows } = await this.previewRows(def, uniqueInns);
    return { ok: true, label: def.label, undoable: def.undoable, rows };
  }

  /** Применение: ≤20 клиник — сразу, больше — через вторую руку (SERVER.md §4). */
  async commit(account: Account, actionKey: string, tenantInns: string[]): Promise<BulkResult<{ report?: BulkReport; secondHandRequest?: SecondHandRequest }>> {
    const def = this.registry[actionKey];
    if (!def) return { ok: false, error: 'Неизвестная массовая операция' };
    await assertPermission(this.repos.auditLog, account, def.requestPermission, `bulk:${actionKey}:commit`, null, null);
    const uniqueInns = [...new Set(tenantInns)];
    if (!uniqueInns.length) return { ok: false, error: 'Сначала отметьте клиники — галочкой в списке' };

    const { rows, nameByInn } = await this.previewRows(def, uniqueInns);
    const okInns = rows.filter((r) => r.ok).map((r) => r.inn);
    const skipped = rows.filter((r) => !r.ok).map((r) => ({ inn: r.inn, name: r.name, why: r.why }));
    if (!okInns.length) return { ok: false, error: 'Применять не к кому: все отмеченные клиники отсеяны проверкой' };

    // Порог считается НАКОПИТЕЛЬНО по сотруднику за сутки: иначе пачку в 60 клиник
    // можно провести без второй руки тремя вызовами по 20.
    const usedToday = await this.usedInWindow(account.id);
    if (okInns.length > SECOND_BULK || usedToday + okInns.length > SECOND_BULK) {
      const secondHandRequest = await this.secondHand.request('bulk:clinics', { actionKey, tenantInns: okInns }, null, account.id);
      return { ok: true, secondHandRequest };
    }

    const report = await this.applyToTenants(actionKey, def, okInns, skipped, nameByInn, account.id);
    await this.addToQuota(account.id, okInns.length);
    return { ok: true, report };
  }

  private async readQuota(): Promise<Record<string, { at: number; count: number }[]>> {
    const cutoff = this.repos.clock.now().getTime() - QUOTA_WINDOW_MS;
    const raw = (await this.repos.channels.get<Record<string, { at: number; count: number }[]>>('platform', null, QUOTA_KEY, {})).data;
    return Object.fromEntries(Object.entries(raw).map(([id, list]) => [id, list.filter((e) => e.at >= cutoff)]));
  }

  private async usedInWindow(actorId: string): Promise<number> {
    return ((await this.readQuota())[actorId] ?? []).reduce((sum, e) => sum + e.count, 0);
  }

  private async addToQuota(actorId: string, count: number): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Record<string, { at: number; count: number }[]>>('platform', null, QUOTA_KEY, {});
      const cutoff = this.repos.clock.now().getTime() - QUOTA_WINDOW_MS;
      const cleaned = Object.fromEntries(Object.entries(rec.data).map(([id, list]) => [id, list.filter((e) => e.at >= cutoff)]));
      const next = { ...cleaned, [actorId]: [...(cleaned[actorId] ?? []), { at: this.repos.clock.now().getTime(), count }] };
      const res = await this.repos.channels.set('platform', null, QUOTA_KEY, next, { expectedVersion: rec.version, updatedBy: actorId });
      if (res.ok) return;
    }
  }

  /** При старте сервера: задачи, оставшиеся «выполняется» от прошлого процесса, уже никогда не завершатся сами. */
  async failInterruptedJobs(): Promise<number> {
    let n = 0;
    await this.mutateJobs((all) => all.map((j) => {
      if (j.status !== 'running') return j;
      n++;
      return { ...j, status: 'failed' as const, finishedAt: todayString(), error: 'Прервано перезапуском сервера — проверьте отчёт и повторите пачку' };
    }));
    return n;
  }

  /**
   * Применяется при подтверждении `bulk:clinics` (см. container.ts) — заводит
   * фоновую задачу и возвращается сразу, не дожидаясь применения ко всем
   * клиникам (см. комментарий у BulkJob). Прогресс и итог — через `getJob`.
   */
  applyFromSecondHand = async (payload: Record<string, unknown>, confirmedById: string): Promise<{ jobId: string }> => {
    const actionKey = String(payload.actionKey);
    const def = this.registry[actionKey];
    if (!def) throw new Error('Неизвестная массовая операция');
    const tenantInns = Array.isArray(payload.tenantInns) ? payload.tenantInns.map(String) : [];
    const jobId = randomUUID();
    const job: BulkJob = {
      id: jobId, actionKey, status: 'running', total: tenantInns.length, doneCount: 0,
      startedAt: todayString(), finishedAt: null, reportId: null, error: null,
    };
    await this.mutateJobs((all) => [job, ...all].slice(0, MAX_JOBS));
    void this.runInBackground(jobId, actionKey, def, tenantInns, confirmedById);
    return { jobId };
  };

  private async runInBackground(jobId: string, actionKey: string, def: BulkActionDef, tenantInns: string[], byId: string): Promise<void> {
    try {
      const tenants = await this.repos.tenants.listAll();
      const nameByInn = new Map(tenants.map((t) => [t.inn, t.name]));
      const report = await this.applyToTenants(actionKey, def, tenantInns, [], nameByInn, byId, (doneCount) => this.patchJob(jobId, { doneCount }));
      await this.patchJob(jobId, { status: 'done', finishedAt: todayString(), reportId: report.id, doneCount: tenantInns.length });
    } catch (err) {
      await this.patchJob(jobId, { status: 'failed', finishedAt: todayString(), error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async mutateJobs(fn: (all: BulkJob[]) => BulkJob[]): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<BulkJob[]>('platform', null, JOBS_KEY, []);
      const res = await this.repos.channels.set('platform', null, JOBS_KEY, fn(rec.data), { expectedVersion: rec.version, updatedBy: null });
      if (res.ok) return;
    }
    throw new Error('Не удалось сохранить состояние фоновой задачи — слишком много параллельных правок');
  }

  private patchJob(jobId: string, patch: Partial<BulkJob>): Promise<void> {
    return this.mutateJobs((all) => all.map((j) => (j.id === jobId ? { ...j, ...patch } : j)));
  }

  /** Прогресс/итог фоновой пачки — панель опрашивает по jobId, полученному от confirm (README «Что дальше»). */
  async getJob(account: Account, jobId: string): Promise<BulkJob | null> {
    await assertPermission(this.repos.auditLog, account, 'clinic:read', 'bulk:job:get', jobId, null);
    const all = (await this.repos.channels.get<BulkJob[]>('platform', null, JOBS_KEY, [])).data;
    return all.find((j) => j.id === jobId) ?? null;
  }

  private async applyToTenants(
    actionKey: string,
    def: BulkActionDef,
    inns: string[],
    skipped: { inn: string; name: string; why: string }[],
    nameByInn: Map<string, string>,
    byId: string,
    onProgress?: (doneCount: number) => Promise<void>,
  ): Promise<BulkReport> {
    const snapshot: BulkSnapshotEntry[] = [];
    for (const inn of inns) {
      const key = def.channelKey(inn);
      if (!key) continue;
      const rec = await this.repos.channels.get('tenant', inn, key, null);
      snapshot.push({ tenantInn: inn, key, data: rec.data, version: rec.version });
    }
    const done: { inn: string; name: string }[] = [];
    const failed: { inn: string; name: string; why: string }[] = [];
    for (const inn of inns) {
      try {
        await def.apply(this.repos, inn, byId);
        done.push({ inn, name: nameByInn.get(inn) ?? inn });
      } catch (err) {
        failed.push({ inn, name: nameByInn.get(inn) ?? inn, why: err instanceof Error ? err.message : String(err) });
      }
      if (onProgress) await onProgress(done.length + failed.length);
    }
    const report: BulkReport = {
      id: randomUUID(),
      actionKey,
      label: def.label,
      at: todayString(),
      byId,
      done,
      skipped,
      failed,
      undoable: def.undoable && snapshot.length > 0,
      undoneAt: null,
      snapshot,
    };
    await this.mutateReports((all) => [report, ...all].slice(0, MAX_REPORTS), byId);
    await this.repos.auditLog.append({
      actorId: byId, actorRole: null, tenantInn: null, action: 'bulk:apply', target: actionKey,
      meta: { label: def.label, done: done.length, skipped: skipped.length, failed: failed.length }, allowed: true,
    });
    return report;
  }

  private async mutateReports(fn: (all: BulkReport[]) => BulkReport[], byId: string | null): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<BulkReport[]>('platform', null, REPORTS_KEY, []);
      const next = fn(rec.data);
      const res = await this.repos.channels.set('platform', null, REPORTS_KEY, next, { expectedVersion: rec.version, updatedBy: byId });
      if (res.ok) return;
    }
    throw new Error('Не удалось сохранить отчёт — слишком много параллельных правок, повторите');
  }

  async listReports(account: Account): Promise<BulkReport[]> {
    await assertPermission(this.repos.auditLog, account, 'clinic:read', 'bulk:reports:list', null, null);
    return (await this.repos.channels.get<BulkReport[]>('platform', null, REPORTS_KEY, [])).data;
  }

  /** Откат целиком по снимку ДО операции (README «откат») — только тем же правом, каким пачка применялась. */
  async undo(account: Account, reportId: string): Promise<BulkResult<{ report: BulkReport }>> {
    const reports = (await this.repos.channels.get<BulkReport[]>('platform', null, REPORTS_KEY, [])).data;
    const report = reports.find((r) => r.id === reportId);
    if (!report) return { ok: false, error: 'Отчёт не найден' };
    const def = this.registry[report.actionKey];
    if (!def) return { ok: false, error: 'Неизвестная массовая операция' };
    await assertPermission(this.repos.auditLog, account, def.requestPermission, 'bulk:undo', report.id, null);
    if (!report.undoable) return { ok: false, error: 'Операция не поддерживает откат' };
    if (report.undoneAt) return { ok: false, error: 'Уже отменено' };

    for (const entry of report.snapshot) {
      await this.restoreEntry(entry, account.id);
    }
    const at = todayString();
    let updated: BulkReport = report;
    await this.mutateReports(
      (all) => all.map((r) => (r.id === reportId ? (updated = { ...r, undoneAt: at }) : r)),
      account.id,
    );
    await this.repos.auditLog.append({ actorId: account.id, actorRole: null, tenantInn: null, action: 'bulk:undo', target: reportId, meta: { label: report.label }, allowed: true });
    return { ok: true, report: updated };
  }

  private async restoreEntry(entry: BulkSnapshotEntry, byId: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await this.repos.channels.get('tenant', entry.tenantInn, entry.key, entry.data);
      const res = await this.repos.channels.set('tenant', entry.tenantInn, entry.key, entry.data, { expectedVersion: cur.version, updatedBy: byId });
      if (res.ok) return;
    }
    throw new Error(`Не удалось откатить «${entry.key}» для ${entry.tenantInn}`);
  }
}
