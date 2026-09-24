import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { TariffService } from './tariffService.js';
import { SecondHandService } from '../secondHand/service.js';
import type { Account } from '../domain/types.js';
import type { TariffDef } from '../shared/channelShapes.js';

function makeAccount(role: Account['role'], id: string): Account {
  return {
    id, inn: '7726345678', login: id, phone: null, email: null, org: null,
    fio: 'Гусев Р. А.', side: 'platform', role, pending: false, requestedRole: null, branchName: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

describe('TariffService — тарифы и продукты (вторая рука на публикацию и удаление)', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let secondHand: SecondHandService;
  let svc: TariffService;
  const manager = makeAccount('sales_manager', 'acc_manager');
  const head = makeAccount('sales_head', 'acc_head');
  const methodist = makeAccount('methodist', 'acc_methodist');

  const draft: TariffDef = { key: 'start', name: 'Старт', price: 15000, period: 'monthly', description: '', active: false };

  beforeEach(() => {
    repos = createMemoryRepos();
    secondHand = new SecondHandService(repos);
    svc = new TariffService(repos, secondHand);
  });

  async function confirm(requestId: string, by: Account, apply: (payload: Record<string, unknown>) => Promise<unknown>) {
    return secondHand.confirm(requestId, by.id, apply);
  }

  it('менеджер сохраняет новый тариф черновиком напрямую, без второй руки', async () => {
    const r = await svc.saveDraft(manager, [draft]);
    expect(r.ok).toBe(true);
    expect(await svc.getTariffs()).toEqual([draft]);
  });

  it('методист не может править тарифы (нет tariff:write)', async () => {
    await expect(svc.saveDraft(methodist, [draft])).rejects.toThrow();
  });

  it('новый тариф нельзя сохранить черновиком сразу активным', async () => {
    const r = await svc.saveDraft(manager, [{ ...draft, active: true }]);
    expect(r.ok).toBe(false);
  });

  it('включение тарифа в продажу — запрос второй руки, тариф не активен до подтверждения', async () => {
    await svc.saveDraft(manager, [draft]);
    const r = await svc.requestPublish(manager, 'start');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await svc.getTariffs())[0]?.active).toBe(false);

    const confirmed = await confirm(r.secondHandRequest.id, head, svc.applyPublish);
    expect(confirmed.ok).toBe(true);
    expect((await svc.getTariffs())[0]?.active).toBe(true);
  });

  it('автор запроса на публикацию не может подтвердить его сам', async () => {
    await svc.saveDraft(manager, [draft]);
    const r = await svc.requestPublish(manager, 'start');
    if (!r.ok) throw new Error('setup failed');
    const selfConfirm = await confirm(r.secondHandRequest.id, manager, svc.applyPublish);
    expect(selfConfirm.ok).toBe(false);
  });

  it('нельзя переключить active через сохранение черновика — только через публикацию/удаление', async () => {
    await svc.saveDraft(manager, [draft]);
    const r = await svc.requestPublish(manager, 'start');
    if (!r.ok) throw new Error('setup failed');
    await confirm(r.secondHandRequest.id, head, svc.applyPublish);

    const sneaky = await svc.saveDraft(manager, [{ ...draft, active: false }]);
    expect(sneaky.ok).toBe(false);
  });

  it('удаление опубликованного тарифа — тоже запрос второй руки', async () => {
    await svc.saveDraft(manager, [draft]);
    const pub = await svc.requestPublish(manager, 'start');
    if (!pub.ok) throw new Error('setup failed');
    await confirm(pub.secondHandRequest.id, head, svc.applyPublish);

    const del = await svc.requestDelete(manager, 'start');
    expect(del.ok).toBe(true);
    if (!del.ok) return;
    expect(await svc.getTariffs()).toHaveLength(1);

    const confirmed = await confirm(del.secondHandRequest.id, head, svc.applyDelete);
    expect(confirmed.ok).toBe(true);
    expect(await svc.getTariffs()).toHaveLength(0);
  });

  it('запрос публикации уже активного тарифа отклоняется', async () => {
    await svc.saveDraft(manager, [draft]);
    const pub = await svc.requestPublish(manager, 'start');
    if (!pub.ok) throw new Error('setup failed');
    await confirm(pub.secondHandRequest.id, head, svc.applyPublish);
    const again = await svc.requestPublish(manager, 'start');
    expect(again.ok).toBe(false);
  });

  it('активный тариф нельзя тихо убрать из массива черновиком', async () => {
    await svc.saveDraft(manager, [draft]);
    const pub = await svc.requestPublish(manager, 'start');
    if (!pub.ok) throw new Error('setup failed');
    await confirm(pub.secondHandRequest.id, head, svc.applyPublish);

    const sneaky = await svc.saveDraft(manager, []);
    expect(sneaky.ok).toBe(false);
    expect(await svc.getTariffs()).toHaveLength(1);
  });
});
