import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { CatalogService } from './catalogService.js';
import type { Account } from '../domain/types.js';

function makeAccount(role: Account['role']): Account {
  return {
    id: 'acc_' + role, inn: '7726345678', login: role, phone: null, email: null, org: null,
    fio: 'Николаева Е. В.', side: 'platform', role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

describe('CatalogService — публикация эталонов методистом', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: CatalogService;
  const methodist = makeAccount('methodist');
  const admin = makeAccount('platform_admin');
  const manager = makeAccount('sales_manager');

  beforeEach(() => {
    repos = createMemoryRepos();
    svc = new CatalogService(repos);
  });

  it('методист публикует каталог чек-листов', async () => {
    const r = await svc.publishChecklists(methodist, [{ name: 'ЧЛ-1', items: ['п1', 'п2'] }]);
    expect(r.ok).toBe(true);
    expect(await svc.getChecklists()).toEqual([{ name: 'ЧЛ-1', items: ['п1', 'п2'] }]);
  });

  it('администратор платформы тоже может публиковать (standard:publish есть у обоих)', async () => {
    const r = await svc.publishChecklists(admin, [{ name: 'ЧЛ-2', items: [] }]);
    expect(r.ok).toBe(true);
  });

  it('менеджер по продажам не может публиковать эталон (нет standard:publish)', async () => {
    await expect(svc.publishChecklists(manager, [])).rejects.toThrow();
  });

  it('публикация с устаревшей версией отклоняется, а не затирает чужую правку', async () => {
    await svc.publishChecklists(methodist, [{ name: 'A', items: [] }]);
    // читаем версию ДО повторной публикации кем-то другим
    const rec = await repos.channels.get('platform', null, 'checklists', []);
    await svc.publishChecklists(methodist, [{ name: 'B', items: [] }]);
    // ручная запись со старой версией, как будто вторая вкладка не обновилась
    const stale = await repos.channels.set('platform', null, 'checklists', [{ name: 'C', items: [] }], { expectedVersion: rec.version, updatedBy: null });
    expect(stale.ok).toBe(false);
    expect(await svc.getChecklists()).toEqual([{ name: 'B', items: [] }]);
  });

  it('методист публикует каталог этапов (stage_docs)', async () => {
    const r = await svc.publishStageDocs(methodist, [{ code: 1, name: 'Этап 1', price: 68000, blocks: [] }]);
    expect(r.ok).toBe(true);
    expect((await svc.getStageDocs())[0]?.price).toBe(68000);
  });

  it('методист публикует годовой цикл (cycle_master)', async () => {
    const r = await svc.publishCycle(methodist, { year: 2026, dirs: [{ name: 'Эпидбезопасность', months: [2, 8] }], capaTerms: [{ level: 'критическое', days: 10 }] });
    expect(r.ok).toBe(true);
    const cycle = await svc.getCycle();
    expect(cycle?.dirs[0]?.months).toEqual([2, 8]);
  });

  it('без публикации getCycle возвращает null, а не бросает ошибку', async () => {
    expect(await svc.getCycle()).toBeNull();
  });
});
