import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import type { ChecklistDef, CycleMaster, EquipmentType, Stage, SummaryRowDef } from '../shared/channelShapes.js';

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

  private async getPlatformChannel<T>(key: string, fallback: T): Promise<T> {
    return (await this.repos.channels.get<T>('platform', null, key, fallback)).data;
  }

  private async publishPlatformChannel<T>(account: Account, key: string, value: T): Promise<CatalogResult<{ version: number }>> {
    await assertPermission(this.repos.auditLog, account, 'standard:publish', `catalog:${key}:publish`, null, null);
    const rec = await this.repos.channels.get<T>('platform', null, key, value);
    const res = await this.repos.channels.set('platform', null, key, value, { expectedVersion: rec.version, updatedBy: account.id });
    if (!res.ok) return { ok: false, error: 'Эталон изменён параллельно — обновите страницу и повторите' };
    return { ok: true, version: res.version };
  }

  getChecklists(): Promise<ChecklistDef[]> {
    return this.getPlatformChannel<ChecklistDef[]>('checklists', []);
  }

  publishChecklists(account: Account, checklists: ChecklistDef[]): Promise<CatalogResult<{ version: number }>> {
    return this.publishPlatformChannel(account, 'checklists', checklists);
  }

  getStageDocs(): Promise<Stage[]> {
    return this.getPlatformChannel<Stage[]>('stage_docs', []);
  }

  publishStageDocs(account: Account, stages: Stage[]): Promise<CatalogResult<{ version: number }>> {
    return this.publishPlatformChannel(account, 'stage_docs', stages);
  }

  getCycle(): Promise<CycleMaster | null> {
    return this.getPlatformChannel<CycleMaster | null>('cycle_master', null);
  }

  publishCycle(account: Account, cycle: CycleMaster): Promise<CatalogResult<{ version: number }>> {
    return this.publishPlatformChannel(account, 'cycle_master', cycle);
  }

  /** Типы оборудования и периодичность форм (README «Оборудование и журналы»). */
  getEquipTypes(): Promise<EquipmentType[]> {
    return this.getPlatformChannel<EquipmentType[]>('equip_types', []);
  }

  publishEquipTypes(account: Account, types: EquipmentType[]): Promise<CatalogResult<{ version: number }>> {
    return this.publishPlatformChannel(account, 'equip_types', types);
  }

  /** Состав сводного отчёта (README «Самообследование», «Сводный отчёт»). */
  getSummaryMaster(): Promise<SummaryRowDef[]> {
    return this.getPlatformChannel<SummaryRowDef[]>('summary_master', []);
  }

  publishSummaryMaster(account: Account, rows: SummaryRowDef[]): Promise<CatalogResult<{ version: number }>> {
    return this.publishPlatformChannel(account, 'summary_master', rows);
  }
}
