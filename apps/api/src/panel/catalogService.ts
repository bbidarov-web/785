import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import type { ChecklistDef, CycleMaster, Stage } from '../shared/channelShapes.js';

export type CatalogResult<T> = { ok: true } & T | { ok: false; error: string };

/**
 * Публикация эталонов методистом (README «Эталоны»: «блоки контроля, типы
 * документов, чек-листы, годовой цикл — редакции, восстановление и пилотный
 * тираж»). Здесь — публикация целиком, без редакций/пилотного тиража и
 * восстановления версий (это отдельная фича прототипа, не перенесена).
 * Право `standard:publish` — методист и администратор платформы, дословно по
 * `platform.js`: «запись в эталон доступна только методисту» + матрица ROLES
 * (platform_admin тоже имеет standard:publish).
 */
export class CatalogService {
  constructor(private repos: Repos) {}

  async getChecklists(): Promise<ChecklistDef[]> {
    return (await this.repos.channels.get<ChecklistDef[]>('platform', null, 'checklists', [])).data;
  }

  async publishChecklists(account: Account, checklists: ChecklistDef[]): Promise<CatalogResult<{ version: number }>> {
    await assertPermission(this.repos.auditLog, account, 'standard:publish', 'catalog:checklists:publish', null, null);
    const rec = await this.repos.channels.get<ChecklistDef[]>('platform', null, 'checklists', []);
    const res = await this.repos.channels.set('platform', null, 'checklists', checklists, { expectedVersion: rec.version, updatedBy: account.id });
    if (!res.ok) return { ok: false, error: 'Каталог изменён параллельно — обновите страницу и повторите' };
    return { ok: true, version: res.version };
  }

  async getStageDocs(): Promise<Stage[]> {
    return (await this.repos.channels.get<Stage[]>('platform', null, 'stage_docs', [])).data;
  }

  async publishStageDocs(account: Account, stages: Stage[]): Promise<CatalogResult<{ version: number }>> {
    await assertPermission(this.repos.auditLog, account, 'standard:publish', 'catalog:stage-docs:publish', null, null);
    const rec = await this.repos.channels.get<Stage[]>('platform', null, 'stage_docs', []);
    const res = await this.repos.channels.set('platform', null, 'stage_docs', stages, { expectedVersion: rec.version, updatedBy: account.id });
    if (!res.ok) return { ok: false, error: 'Каталог изменён параллельно — обновите страницу и повторите' };
    return { ok: true, version: res.version };
  }

  async getCycle(): Promise<CycleMaster | null> {
    const rec = await this.repos.channels.get<CycleMaster | null>('platform', null, 'cycle_master', null);
    return rec.data;
  }

  async publishCycle(account: Account, cycle: CycleMaster): Promise<CatalogResult<{ version: number }>> {
    await assertPermission(this.repos.auditLog, account, 'standard:publish', 'catalog:cycle:publish', null, null);
    const rec = await this.repos.channels.get<CycleMaster | null>('platform', null, 'cycle_master', null);
    const res = await this.repos.channels.set('platform', null, 'cycle_master', cycle, { expectedVersion: rec.version, updatedBy: account.id });
    if (!res.ok) return { ok: false, error: 'Эталон изменён параллельно — обновите страницу и повторите' };
    return { ok: true, version: res.version };
  }
}
