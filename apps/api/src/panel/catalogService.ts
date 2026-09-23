import type { Repos } from '../domain/ports.js';
import type { Account, SecondHandRequest } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { SecondHandService } from '../secondHand/service.js';
import type { ChecklistDef, CycleMaster, EquipmentType, Stage, SummaryRowDef } from '../shared/channelShapes.js';

export type CatalogResult<T> = { ok: true } & T | { ok: false; error: string };

/**
 * Публикация эталонов методистом (README «Эталоны»: «блоки контроля, типы
 * документов, чек-листы, годовой цикл — редакции, восстановление и пилотный
 * тираж»). Здесь — публикация целиком, без редакций/пилотного тиража и
 * восстановления версий (это отдельная фича прототипа, не перенесена).
 *
 * Публикация — одна из семи операций второй руки (`standard:publish`,
 * SERVER.md §4): вместо прямой записи заводится запрос, ВТОРОЙ сотрудник с
 * `second:standard` (методист или администратор платформы, не автор запроса)
 * подтверждает его через общий `/api/second-hand/:id/confirm` — применение
 * читает `applyPublish` из реестра `secondHandHandlers` (container.ts).
 */
export class CatalogService {
  constructor(
    private repos: Repos,
    private secondHand: SecondHandService,
  ) {}

  private async getPlatformChannel<T>(key: string, fallback: T): Promise<T> {
    return (await this.repos.channels.get<T>('platform', null, key, fallback)).data;
  }

  private async requestPublish<T>(account: Account, key: string, value: T): Promise<CatalogResult<{ secondHandRequest: SecondHandRequest }>> {
    await assertPermission(this.repos.auditLog, account, 'standard:publish', `catalog:${key}:publish`, null, null);
    const secondHandRequest = await this.secondHand.request('standard:publish', { key, value }, null, account.id);
    return { ok: true, secondHandRequest };
  }

  getChecklists(): Promise<ChecklistDef[]> {
    return this.getPlatformChannel<ChecklistDef[]>('checklists', []);
  }

  publishChecklists(account: Account, checklists: ChecklistDef[]): Promise<CatalogResult<{ secondHandRequest: SecondHandRequest }>> {
    return this.requestPublish(account, 'checklists', checklists);
  }

  getStageDocs(): Promise<Stage[]> {
    return this.getPlatformChannel<Stage[]>('stage_docs', []);
  }

  publishStageDocs(account: Account, stages: Stage[]): Promise<CatalogResult<{ secondHandRequest: SecondHandRequest }>> {
    return this.requestPublish(account, 'stage_docs', stages);
  }

  getCycle(): Promise<CycleMaster | null> {
    return this.getPlatformChannel<CycleMaster | null>('cycle_master', null);
  }

  publishCycle(account: Account, cycle: CycleMaster): Promise<CatalogResult<{ secondHandRequest: SecondHandRequest }>> {
    return this.requestPublish(account, 'cycle_master', cycle);
  }

  /** Типы оборудования и периодичность форм (README «Оборудование и журналы»). */
  getEquipTypes(): Promise<EquipmentType[]> {
    return this.getPlatformChannel<EquipmentType[]>('equip_types', []);
  }

  publishEquipTypes(account: Account, types: EquipmentType[]): Promise<CatalogResult<{ secondHandRequest: SecondHandRequest }>> {
    return this.requestPublish(account, 'equip_types', types);
  }

  /** Состав сводного отчёта (README «Самообследование», «Сводный отчёт»). */
  getSummaryMaster(): Promise<SummaryRowDef[]> {
    return this.getPlatformChannel<SummaryRowDef[]>('summary_master', []);
  }

  publishSummaryMaster(account: Account, rows: SummaryRowDef[]): Promise<CatalogResult<{ secondHandRequest: SecondHandRequest }>> {
    return this.requestPublish(account, 'summary_master', rows);
  }

  /** Применяется при подтверждении `standard:publish` — см. container.ts. */
  applyPublish = async (payload: Record<string, unknown>): Promise<{ key: string; version: number }> => {
    const key = String(payload.key);
    const value = payload.value;
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get('platform', null, key, value);
      const res = await this.repos.channels.set('platform', null, key, value, { expectedVersion: rec.version, updatedBy: null });
      if (res.ok) return { key, version: res.version };
    }
    throw new Error('Не удалось опубликовать — слишком много параллельных правок, повторите');
  };
}
