import type { Repos } from '../domain/ports.js';
import type { Account, SecondHandRequest } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { SecondHandService } from '../secondHand/service.js';
import { StandardEditionService, isCatalogKey } from '../standard/editions.js';
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
    const secondHandRequest = await this.secondHand.request('standard:publish', { key, value, requestedBy: account.id }, null, account.id);
    return { ok: true, secondHandRequest };
  }

  /** Кабинет клиники (account.side = clinic) получает ПРИНЯТУЮ редакцию каталога, платформа — последнюю. */
  private forViewer<T>(account: Account | undefined, key: 'checklists' | 'stage_docs' | 'cycle_master' | 'equip_types' | 'summary_master', fallback: T): Promise<T> {
    if (account?.side === 'clinic') return new StandardEditionService(this.repos).catalog<T>(account.inn, key, fallback);
    return this.getPlatformChannel<T>(key, fallback);
  }

  getChecklists(account?: Account): Promise<ChecklistDef[]> {
    return this.forViewer<ChecklistDef[]>(account, 'checklists', []);
  }

  publishChecklists(account: Account, checklists: ChecklistDef[]): Promise<CatalogResult<{ secondHandRequest: SecondHandRequest }>> {
    return this.requestPublish(account, 'checklists', checklists);
  }

  getStageDocs(account?: Account): Promise<Stage[]> {
    return this.forViewer<Stage[]>(account, 'stage_docs', []);
  }

  publishStageDocs(account: Account, stages: Stage[]): Promise<CatalogResult<{ secondHandRequest: SecondHandRequest }>> {
    return this.requestPublish(account, 'stage_docs', stages);
  }

  getCycle(account?: Account): Promise<CycleMaster | null> {
    return this.forViewer<CycleMaster | null>(account, 'cycle_master', null);
  }

  publishCycle(account: Account, cycle: CycleMaster): Promise<CatalogResult<{ secondHandRequest: SecondHandRequest }>> {
    return this.requestPublish(account, 'cycle_master', cycle);
  }

  /** Типы оборудования и периодичность форм (README «Оборудование и журналы»). */
  getEquipTypes(account?: Account): Promise<EquipmentType[]> {
    return this.forViewer<EquipmentType[]>(account, 'equip_types', []);
  }

  publishEquipTypes(account: Account, types: EquipmentType[]): Promise<CatalogResult<{ secondHandRequest: SecondHandRequest }>> {
    return this.requestPublish(account, 'equip_types', types);
  }

  /** Состав сводного отчёта (README «Самообследование», «Сводный отчёт»). */
  getSummaryMaster(account?: Account): Promise<SummaryRowDef[]> {
    return this.forViewer<SummaryRowDef[]>(account, 'summary_master', []);
  }

  publishSummaryMaster(account: Account, rows: SummaryRowDef[]): Promise<CatalogResult<{ secondHandRequest: SecondHandRequest }>> {
    return this.requestPublish(account, 'summary_master', rows);
  }

  /** Применяется при подтверждении `standard:publish` — см. container.ts. Выпускает НОВУЮ неизменяемую редакцию (standard/editions.ts) и обновляет живую версию каталога. */
  applyPublish = async (payload: Record<string, unknown>, confirmedById?: string): Promise<{ key: string; version: number; edition: number | null }> => {
    const key = String(payload.key);
    const value = payload.value;
    let edition: number | null = null;
    if (isCatalogKey(key)) {
      const meta = await new StandardEditionService(this.repos).publish(key, value, confirmedById ?? null, typeof payload.requestedBy === 'string' ? payload.requestedBy : null);
      edition = meta?.no ?? null;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get('platform', null, key, value);
      const res = await this.repos.channels.set('platform', null, key, value, { expectedVersion: rec.version, updatedBy: null });
      if (res.ok) return { key, version: res.version, edition };
    }
    throw new Error('Не удалось опубликовать — слишком много параллельных правок, повторите');
  };
}
