import { randomUUID } from 'node:crypto';
import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission, visibleToBranch } from '../rbac/service.js';
import { normalizeDateInput } from '../shared/date.js';
import type { AuditPlanItem } from '../shared/channelShapes.js';

export type PlanResult<T> = { ok: true } & T | { ok: false; error: string };

export interface PlanInput {
  date: string;
  dir: string;
  object: string;
  branch?: string;
  who: string;
  kind: 'плановая' | 'внеплановая' | 'целевая';
  check?: string;
}

/**
 * План проверок клиники — ручные записи (README «Этапы внедрения», раздел
 * «План проверок»; форма «Новая проверка в плане» в
 * reference/prototype/Личный кабинет ВКК.dc.html, строки ~1731–1796).
 *
 * Прототип публикует в `audit_plan` ДВЕ вещи: ручные записи (`plannedAudits`)
 * и записи, автоматически выведенные из годового цикла клиники (эталон
 * методиста + помесячная разбивка). Годовой цикл ещё не перенесён (нужна
 * панель методиста) — этот сервис переносит только ручную часть, которая уже
 * самодостаточна и полностью потребляется исполнителем и обходом.
 */
export class PlanService {
  constructor(private repos: Repos) {}

  async list(account: Account): Promise<AuditPlanItem[]> {
    await assertPermission(this.repos.auditLog, account, 'plan:read', 'plan:list', null, account.inn);
    const items = (await this.repos.channels.get<AuditPlanItem[]>('tenant', account.inn, 'audit_plan', [])).data;
    return items.filter((p) => visibleToBranch(account, p.branch));
  }

  async create(account: Account, input: PlanInput): Promise<PlanResult<{ item: AuditPlanItem }>> {
    await assertPermission(this.repos.auditLog, account, 'plan:write', 'plan:create', null, account.inn);
    if (!input.dir.trim()) return { ok: false, error: 'Направление контроля обязательно' };
    const date = normalizeDateInput(input.date);
    if (date === null) return { ok: false, error: 'Дата проверки не распознана — нужен формат ДД.ММ.ГГГГ' };
    const item: AuditPlanItem = {
      id: randomUUID(),
      name: input.dir.trim(),
      dir: input.dir.trim(),
      check: input.check?.trim() || undefined,
      object: input.object.trim(),
      branch: input.branch?.trim() || '',
      kind: input.kind,
      date,
      who: input.who.trim(),
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<AuditPlanItem[]>('tenant', account.inn, 'audit_plan', []);
      const next = rec.data.concat([item]);
      const res = await this.repos.channels.set('tenant', account.inn, 'audit_plan', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, item };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  async update(account: Account, id: string, patch: Partial<PlanInput>): Promise<PlanResult<{ item: AuditPlanItem }>> {
    await assertPermission(this.repos.auditLog, account, 'plan:write', 'plan:update', id, account.inn);
    const patchDate = patch.date === undefined ? undefined : normalizeDateInput(patch.date);
    if (patchDate === null) return { ok: false, error: 'Дата проверки не распознана — нужен формат ДД.ММ.ГГГГ' };
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<AuditPlanItem[]>('tenant', account.inn, 'audit_plan', []);
      const idx = rec.data.findIndex((p) => p.id === id);
      if (idx === -1) return { ok: false, error: 'Проверка не найдена' };
      const current = rec.data[idx]!;
      const updated: AuditPlanItem = {
        ...current,
        name: patch.dir?.trim() ?? current.name,
        dir: patch.dir?.trim() ?? current.dir,
        check: patch.check !== undefined ? patch.check.trim() || undefined : current.check,
        object: patch.object?.trim() ?? current.object,
        branch: patch.branch?.trim() ?? current.branch,
        kind: patch.kind ?? current.kind,
        date: patchDate ?? current.date,
        who: patch.who?.trim() ?? current.who,
      };
      const next = rec.data.slice();
      next[idx] = updated;
      const res = await this.repos.channels.set('tenant', account.inn, 'audit_plan', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, item: updated };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  async remove(account: Account, id: string): Promise<PlanResult<Record<string, unknown>>> {
    await assertPermission(this.repos.auditLog, account, 'plan:write', 'plan:remove', id, account.inn);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<AuditPlanItem[]>('tenant', account.inn, 'audit_plan', []);
      if (!rec.data.some((p) => p.id === id)) return { ok: false, error: 'Проверка не найдена' };
      const next = rec.data.filter((p) => p.id !== id);
      const res = await this.repos.channels.set('tenant', account.inn, 'audit_plan', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }
}
