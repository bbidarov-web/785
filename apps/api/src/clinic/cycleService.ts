import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import type { AuditPlanItem, CapaTerm, CycleLive, CycleLiveDirection, CycleMaster } from '../shared/channelShapes.js';

export type CycleResult<T> = { ok: true } & T | { ok: false; error: string };

export interface MergedCycleDirection {
  name: string;
  months: number[];
  check: string;
  object: string;
  branch: string;
  who: string;
}

/** Короткий стабильный идентификатор направления — не зависит от порядка в массиве и не требует транслитерации. */
function stableId(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Разбор годового цикла клиникой (README «Что дальше» до этого шага):
 * методист публикует эталон (`cycle_master` — направление и месяцы), клиника
 * донастраивает каждое направление под себя (чек-лист, объект, филиал,
 * ответственный) и генерирует из этого строки плана проверок — `audit_plan`,
 * который уже читают исполнитель и обход (перенесены раньше).
 *
 * Сгенерированные строки помечены id с префиксом `cyc-` и не пересекаются с
 * ручными записями `PlanService` (случайные UUID) — повторная генерация
 * просто пересобирает `cyc-`-строки заново, ручные записи не трогает.
 */
export class CycleService {
  constructor(private repos: Repos) {}

  /** Публичный: массовая операция «Применить годовой цикл» (`BulkOperationService`) читает эталон для предпросмотра до подтверждения. */
  async getMaster(): Promise<CycleMaster | null> {
    return (await this.repos.channels.get<CycleMaster | null>('platform', null, 'cycle_master', null)).data;
  }

  private async getLive(account: Account): Promise<CycleLive> {
    return (await this.repos.channels.get<CycleLive>('tenant', account.inn, 'cycle_live', { year: new Date().getFullYear(), dirs: [] })).data;
  }

  async getMergedView(account: Account): Promise<CycleResult<{ year: number; dirs: MergedCycleDirection[]; capaTerms: CapaTerm[] }>> {
    await assertPermission(this.repos.auditLog, account, 'plan:read', 'cycle:view', null, account.inn);
    const master = await this.getMaster();
    if (!master) return { ok: false, error: 'Годовой цикл ещё не опубликован методистом' };
    const live = await this.getLive(account);
    const liveByName = new Map(live.dirs.map((d) => [d.name, d]));
    const dirs: MergedCycleDirection[] = master.dirs.map((m) => {
      const l = liveByName.get(m.name);
      return {
        name: m.name,
        months: l?.months ?? m.months,
        check: l?.check ?? '',
        object: l?.object ?? '',
        branch: l?.branch ?? '',
        who: l?.who ?? '',
      };
    });
    return { ok: true, year: master.year, dirs, capaTerms: master.capaTerms };
  }

  async customizeDirection(account: Account, name: string, patch: Partial<Omit<CycleLiveDirection, 'name'>>): Promise<CycleResult<{ direction: CycleLiveDirection }>> {
    await assertPermission(this.repos.auditLog, account, 'plan:write', 'cycle:customize', name, account.inn);
    const master = await this.getMaster();
    if (!master || !master.dirs.some((d) => d.name === name)) {
      return { ok: false, error: 'Направление не найдено в опубликованном эталоне' };
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<CycleLive>('tenant', account.inn, 'cycle_live', { year: master.year, dirs: [] });
      const idx = rec.data.dirs.findIndex((d) => d.name === name);
      const current = idx >= 0 ? rec.data.dirs[idx]! : { name };
      const updated: CycleLiveDirection = { ...current, ...patch, name };
      const dirs = rec.data.dirs.slice();
      if (idx >= 0) dirs[idx] = updated;
      else dirs.push(updated);
      const next: CycleLive = { year: rec.data.year, dirs };
      const res = await this.repos.channels.set('tenant', account.inn, 'cycle_live', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, direction: updated };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  /**
   * Полная замена цикла клиники эталоном — без проверки прав вызывающего,
   * используется массовой операцией «Применить годовой цикл»
   * (`BulkOperationService`), которая уже проверила право на саму пачку
   * (`bulk:methodology`) при подготовке. Прототип: «текущий цикл клиники
   * заменяется эталонным целиком» (Админ-панель.dc.html, ~строка 10799) —
   * собственная донастройка направлений (чек-лист, объект, филиал,
   * ответственный) при этом теряется, план проверок нужно собрать заново.
   */
  async applyMasterToTenant(tenantInn: string, byId: string): Promise<CycleLive> {
    const master = await this.getMaster();
    if (!master) throw new Error('Годовой цикл ещё не опубликован методистом');
    const dirs: CycleLiveDirection[] = master.dirs.map((d) => ({ name: d.name, months: d.months }));
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<CycleLive>('tenant', tenantInn, 'cycle_live', { year: master.year, dirs: [] });
      const next: CycleLive = { year: master.year, dirs };
      const res = await this.repos.channels.set('tenant', tenantInn, 'cycle_live', next, { expectedVersion: rec.version, updatedBy: byId });
      if (res.ok) return next;
    }
    throw new Error('Не удалось сохранить — слишком много параллельных правок, повторите');
  }

  /** Пересобирает строки плана, выведенные из цикла — ручные записи `PlanService` не затрагивает. */
  async generatePlan(account: Account): Promise<CycleResult<{ generated: number }>> {
    await assertPermission(this.repos.auditLog, account, 'plan:write', 'cycle:generate', null, account.inn);
    const merged = await this.getMergedView(account);
    if (!merged.ok) return merged;

    const generated: AuditPlanItem[] = [];
    for (const dir of merged.dirs) {
      for (const month of dir.months) {
        generated.push({
          id: `cyc-${stableId(dir.name)}-${month}`,
          name: dir.name,
          dir: dir.name,
          check: dir.check || undefined,
          object: dir.object || undefined,
          branch: dir.branch || undefined,
          kind: 'плановая',
          date: `01.${pad2(month + 1)}.${merged.year}`,
          who: dir.who || undefined,
        });
      }
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<AuditPlanItem[]>('tenant', account.inn, 'audit_plan', []);
      const manual = rec.data.filter((p) => !p.id.startsWith('cyc-'));
      const next = manual.concat(generated);
      const res = await this.repos.channels.set('tenant', account.inn, 'audit_plan', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, generated: generated.length };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }
}
