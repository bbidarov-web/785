import { randomUUID } from 'node:crypto';
import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import type { Branch } from '../shared/channelShapes.js';

export type BranchResult<T> = { ok: true } & T | { ok: false; error: string };

/**
 * Филиалы клиники (README «Профиль клиники»: «Реквизиты, виды работ, филиалы
 * и кабинеты — источник всех переменных»). Список объектов, по которым
 * строится система качества отдельно — план проверок, оборудование и годовой
 * цикл уже принимают `branch` как поле, но без списка филиалов взять его
 * было неоткуда, кроме свободного текста. Управление списком — решение
 * профиля организации (`org:write`, только `clinic_admin`).
 */
export class BranchService {
  constructor(private repos: Repos) {}

  async list(account: Account): Promise<Branch[]> {
    await assertPermission(this.repos.auditLog, account, 'doc:read', 'branch:list', null, account.inn);
    return (await this.repos.channels.get<Branch[]>('tenant', account.inn, 'branches', [])).data;
  }

  async upsert(account: Account, name: string): Promise<BranchResult<{ branch: Branch }>> {
    await assertPermission(this.repos.auditLog, account, 'org:write', 'branch:upsert', name, account.inn);
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: 'Название филиала обязательно' };
    const branch: Branch = { id: randomUUID(), name: trimmed };
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Branch[]>('tenant', account.inn, 'branches', []);
      const next = rec.data.concat([branch]);
      const res = await this.repos.channels.set('tenant', account.inn, 'branches', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, branch };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  async remove(account: Account, id: string): Promise<BranchResult<Record<string, unknown>>> {
    await assertPermission(this.repos.auditLog, account, 'org:write', 'branch:remove', id, account.inn);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Branch[]>('tenant', account.inn, 'branches', []);
      if (!rec.data.some((b) => b.id === id)) return { ok: false, error: 'Филиал не найден' };
      const next = rec.data.filter((b) => b.id !== id);
      const res = await this.repos.channels.set('tenant', account.inn, 'branches', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }
}
