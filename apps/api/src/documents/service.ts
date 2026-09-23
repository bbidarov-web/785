import type { Repos } from '../domain/ports.js';
import type { Account, DocumentGrantRow } from '../domain/types.js';

export type DocResult<T> = { ok: true } & T | { ok: false; error: string };

/**
 * Выдача документов клинике (README "Выдача документов", SERVER.md §5).
 * Оплата этапа открывает СОСТАВ, но не шаблон — шаблон отдаётся только при
 * наличии активной записи выдачи. Каждая выдача и отзыв — отдельная строка в журнале.
 */
export class DocumentService {
  constructor(private repos: Repos) {}

  async isGranted(tenantInn: string, code: string): Promise<boolean> {
    const last = await this.repos.documentGrants.latestEvent(tenantInn, code);
    return last?.event === 'grant';
  }

  /** Шаблон отдаётся API только при наличии выдачи — проверка на API, а не в интерфейсе (SERVER.md §5). */
  async getTemplateIfGranted(tenantInn: string, code: string, load: () => Promise<string>): Promise<DocResult<{ content: string }>> {
    if (!(await this.isGranted(tenantInn, code))) {
      return { ok: false, error: 'Документ ожидает выдачи' };
    }
    return { ok: true, content: await load() };
  }

  async grant(tenantInn: string, stage: string, code: string, name: string, by: Account, paid: boolean): Promise<DocumentGrantRow> {
    const row = await this.repos.documentGrants.appendEvent({
      tenantInn,
      stage,
      code,
      name,
      event: 'grant',
      byAccountId: by.id,
      byRole: by.role,
      paid,
    });
    await this.repos.auditLog.append({
      actorId: by.id,
      actorRole: by.role,
      tenantInn,
      action: 'document:grant',
      target: code,
      meta: { stage, name, paid },
      allowed: true,
    });
    return row;
  }

  async revoke(tenantInn: string, stage: string, code: string, name: string, by: Account): Promise<DocumentGrantRow> {
    const row = await this.repos.documentGrants.appendEvent({
      tenantInn,
      stage,
      code,
      name,
      event: 'revoke',
      byAccountId: by.id,
      byRole: by.role,
      paid: true,
    });
    await this.repos.auditLog.append({
      actorId: by.id,
      actorRole: by.role,
      tenantInn,
      action: 'document:revoke',
      target: code,
      meta: { stage, name },
      allowed: true,
    });
    return row;
  }

  async listActiveGrants(tenantInn: string): Promise<Record<string, DocumentGrantRow>> {
    const all = await this.repos.documentGrants.listForTenant(tenantInn);
    const byCode = new Map<string, DocumentGrantRow>();
    // всё уже отсортировано по убыванию времени — первая встреченная запись самая свежая
    for (const row of all) if (!byCode.has(row.code)) byCode.set(row.code, row);
    const active: Record<string, DocumentGrantRow> = {};
    for (const [code, row] of byCode) if (row.event === 'grant') active[code] = row;
    return active;
  }
}
