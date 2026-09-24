import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import type { ClinicProfile } from '../shared/channelShapes.js';

export type ProfileResult<T> = { ok: true } & T | { ok: false; error: string };

export const EMPTY_PROFILE: ClinicProfile = { orgFull: '', orgShort: '', license: '', chiefDoctor: '', city: '' };

/**
 * Реквизиты клиники (README «Профиль клиники»: «Реквизиты, виды работ,
 * филиалы и кабинеты — источник всех переменных»). Здесь — сами реквизиты;
 * виды работ и кабинеты — часть филиалов, не перенесены (см. README
 * «Известные ограничения»). Правит только `clinic_admin` (`org:write` —
 * единственная роль с этим правом в матрице ROLES), читают все роли клиники
 * (`doc:read`) — реквизиты подставляются в шаблоны документов всем, кто их открывает.
 */
export class ProfileService {
  constructor(private repos: Repos) {}

  async get(account: Account): Promise<ClinicProfile> {
    await assertPermission(this.repos.auditLog, account, 'doc:read', 'profile:view', null, account.inn);
    return this.getForTenant(account.inn);
  }

  async getForTenant(tenantInn: string): Promise<ClinicProfile> {
    return (await this.repos.channels.get<ClinicProfile>('tenant', tenantInn, 'profile', EMPTY_PROFILE)).data;
  }

  async save(account: Account, next: ClinicProfile): Promise<ProfileResult<{ profile: ClinicProfile }>> {
    await assertPermission(this.repos.auditLog, account, 'org:write', 'profile:save', null, account.inn);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<ClinicProfile>('tenant', account.inn, 'profile', EMPTY_PROFILE);
      const res = await this.repos.channels.set('tenant', account.inn, 'profile', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, profile: next };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }
}
