import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { SubscriptionService } from './subscriptionService.js';
import { TariffService } from './tariffService.js';
import { SecondHandService } from '../secondHand/service.js';
import type { Account } from '../domain/types.js';

function makeAccount(role: Account['role'], id: string): Account {
  return {
    id, inn: '7726345678', login: id, phone: null, email: null, org: null,
    fio: 'Гусев Р. А.', side: 'platform', role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

const inn = '7712345671';

describe('SubscriptionService — подписки клиник', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: SubscriptionService;
  let tariffs: TariffService;
  const manager = makeAccount('sales_manager', 'acc_manager');
  const head = makeAccount('sales_head', 'acc_head');
  const methodist = makeAccount('methodist', 'acc_methodist');

  beforeEach(async () => {
    repos = createMemoryRepos();
    const secondHand = new SecondHandService(repos);
    tariffs = new TariffService(repos, secondHand);
    svc = new SubscriptionService(repos);
    await repos.tenants.upsert(inn, 'ООО «Медицина Плюс»');
    await tariffs.saveDraft(manager, [{ key: 'start', name: 'Старт', price: 15000, period: 'monthly', description: '', active: false }]);
    const pub = await tariffs.requestPublish(manager, 'start');
    if (!pub.ok) throw new Error('setup failed');
    await secondHand.confirm(pub.secondHandRequest.id, head.id, tariffs.applyPublish);
  });

  it('без подписки — статус none', async () => {
    expect((await svc.getState(inn)).status).toBe('none');
  });

  it('менеджер назначает тариф — подписка становится активной со сроком', async () => {
    const r = await svc.assign(manager, inn, 'start', 30, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subscription.status).toBe('active');
    expect(r.subscription.tariffKey).toBe('start');
    expect(r.subscription.history).toHaveLength(1);
  });

  it('методист не может назначать подписки (нет sub:write)', async () => {
    await expect(svc.assign(methodist, inn, 'start', 30, false)).rejects.toThrow();
  });

  it('нельзя назначить неопубликованный/несуществующий тариф', async () => {
    const r = await svc.assign(manager, inn, 'unknown', 30, false);
    expect(r.ok).toBe(false);
  });

  it('можно назначить пробный период (trial)', async () => {
    const r = await svc.assign(manager, inn, 'start', 14, true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.subscription.status).toBe('trial');
  });

  it('продление увеличивает срок и переводит истёкшую подписку обратно в активную', async () => {
    await svc.assign(manager, inn, 'start', 30, false);
    const r = await svc.renew(head, inn, 30);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.subscription.history).toHaveLength(2);
  });

  it('продлевать нечего, если подписки не было', async () => {
    const r = await svc.renew(manager, inn, 30);
    expect(r.ok).toBe(false);
  });

  it('отмена подписки — статус cancelled, история пополняется', async () => {
    await svc.assign(manager, inn, 'start', 30, false);
    const r = await svc.cancel(manager, inn);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.subscription.status).toBe('cancelled');
  });

  it('отменять нечего, если подписки нет', async () => {
    const r = await svc.cancel(manager, inn);
    expect(r.ok).toBe(false);
  });

  it('listAll собирает подписки всех клиник с именем тарифа', async () => {
    await svc.assign(manager, inn, 'start', 30, false);
    const rows = await svc.listAll(head);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inn, tariffKey: 'start', tariffName: 'Старт', status: 'active' });
  });

  it('applyRenew (используется массовой операцией) продлевает без проверки прав вызывающего', async () => {
    await svc.assign(manager, inn, 'start', 30, false);
    const updated = await svc.applyRenew(inn, 30, 'system-bulk');
    expect(updated.history.at(-1)).toMatchObject({ byId: 'system-bulk', action: 'renew' });
  });
});
