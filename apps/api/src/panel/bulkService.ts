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
    const rows: BulkPreviewRow[] = [];
    for (const inn of tenantInns) {
      const name = nameByInn.get(inn) ?? inn;
      let result: BulkCheckResult;
      try {
        result = await def.check(this.repos, inn);
      } catch {
        result = { ok: false, why: 'ошибка проверки' };
      }
      rows.push({ inn, name, ok: !!result.ok, why: result.why ?? '', preview: result.preview ?? '' });
    }
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

    if (okInns.length > SECOND_BULK) {
      const secondHandRequest = await this.secondHand.request('bulk:clinics', { actionKey, tenantInns: okInns }, null, account.id);
      return { ok: true, secondHandRequest };
    }

    const report = await this.applyToTenants(actionKey, def, okInns, skipped, nameByInn, account.id);
    return { ok: true, report };
  }

  /** Применяется при подтверждении `bulk:clinics` — см. container.ts. */
  applyFromSecondHand = async (payload: Record<string, unknown>, confirmedById: string): Promise<BulkReport> => {
    const actionKey = String(payload.actionKey);
    const def = this.registry[actionKey];
    if (!def) throw new Error('Неизвестная массовая операция');
    const tenantInns = Array.isArray(payload.tenantInns) ? payload.tenantInns.map(String) : [];
    const tenants = await this.repos.tenants.listAll();
    const nameByInn = new Map(tenants.map((t) => [t.inn, t.name]));
    return this.applyToTenants(actionKey, def, tenantInns, [], nameByInn, confirmedById);
  };

  private async applyToTenants(
    actionKey: string,
    def: BulkActionDef,
    inns: string[],
    skipped: { inn: string; name: string; why: string }[],
    nameByInn: Map<string, string>,
    byId: string,
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
