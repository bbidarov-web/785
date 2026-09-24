import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { CatalogService } from './catalogService.js';
import { SecondHandService } from '../secondHand/service.js';
import type { Account } from '../domain/types.js';

function makeAccount(role: Account['role'], id?: string): Account {
  return {
    id: id ?? 'acc_' + role, inn: '7726345678', login: role, phone: null, email: null, org: null,
    fio: 'Николаева Е. В.', side: 'platform', role, pending: false, requestedRole: null, branchName: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

describe('CatalogService — публикация эталонов методистом (вторая рука)', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let secondHand: SecondHandService;
  let svc: CatalogService;
  const methodist = makeAccount('methodist', 'acc_methodist');
  const admin = makeAccount('platform_admin', 'acc_admin');
  const manager = makeAccount('sales_manager', 'acc_manager');

  async function confirm(requestId: string, by: Account) {
    return secondHand.confirm(requestId, by.id, svc.applyPublish);
  }

  beforeEach(() => {
    repos = createMemoryRepos();
    secondHand = new SecondHandService(repos);
    svc = new CatalogService(repos, secondHand);
  });

  it('методист заводит запрос на публикацию каталога чек-листов — канал не меняется до подтверждения', async () => {
    const r = await svc.publishChecklists(methodist, [{ name: 'ЧЛ-1', items: ['п1', 'п2'] }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await svc.getChecklists()).toEqual([]);

    const confirmed = await confirm(r.secondHandRequest.id, admin);
    expect(confirmed.ok).toBe(true);
    expect(await svc.getChecklists()).toEqual([{ name: 'ЧЛ-1', items: ['п1', 'п2'] }]);
  });

  it('менеджер по продажам не может запросить публикацию эталона (нет standard:publish)', async () => {
    await expect(svc.publishChecklists(manager, [])).rejects.toThrow();
  });

  it('методист не может подтвердить свой же запрос на публикацию — своей рукой нельзя', async () => {
    const r = await svc.publishChecklists(methodist, [{ name: 'ЧЛ', items: [] }]);
    if (!r.ok) throw new Error('setup failed');
    const selfConfirm = await confirm(r.secondHandRequest.id, methodist);
    expect(selfConfirm.ok).toBe(false);
    expect(await svc.getChecklists()).toEqual([]);
  });

  it('администратор платформы публикует каталог этапов (stage_docs) после запроса методиста', async () => {
    const r = await svc.publishStageDocs(methodist, [{ code: 1, name: 'Этап 1', price: 68000, blocks: [] }]);
    if (!r.ok) throw new Error('setup failed');
    await confirm(r.secondHandRequest.id, admin);
    expect((await svc.getStageDocs())[0]?.price).toBe(68000);
  });

  it('публикует годовой цикл (cycle_master) после подтверждения', async () => {
    const r = await svc.publishCycle(methodist, { year: 2026, dirs: [{ name: 'Эпидбезопасность', months: [2, 8] }], capaTerms: [{ level: 'критическое', days: 10 }] });
    if (!r.ok) throw new Error('setup failed');
    await confirm(r.secondHandRequest.id, admin);
    const cycle = await svc.getCycle();
    expect(cycle?.dirs[0]?.months).toEqual([2, 8]);
  });

  it('без публикации getCycle возвращает null, а не бросает ошибку', async () => {
    expect(await svc.getCycle()).toBeNull();
  });

  it('два запроса подряд применяются оба — второй перезаписывает эталон целиком (публикация не версионируется поверх запроса)', async () => {
    const r1 = await svc.publishChecklists(methodist, [{ name: 'A', items: [] }]);
    const r2 = await svc.publishChecklists(methodist, [{ name: 'B', items: [] }]);
    if (!r1.ok || !r2.ok) throw new Error('setup failed');
    await confirm(r1.secondHandRequest.id, admin);
    await confirm(r2.secondHandRequest.id, admin);
    expect(await svc.getChecklists()).toEqual([{ name: 'B', items: [] }]);
  });
});
