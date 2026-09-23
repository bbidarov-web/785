import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { DashboardService } from './dashboardService.js';
import type { Account } from '../domain/types.js';
import type { CapaItem, StagePaymentState, SubscriptionState, TariffDef } from '../shared/channelShapes.js';

function makeAccount(role: Account['role']): Account {
  return {
    id: 'acc_' + role, inn: '7726345678', login: role, phone: null, email: null, org: null,
    fio: 'Тест', side: 'platform', role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

describe('DashboardService — каталог клиентов', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: DashboardService;
  const methodist = makeAccount('methodist');
  const manager = makeAccount('sales_manager');
  const nurse = { ...makeAccount('nurse'), side: 'clinic' as const, inn: '7712345671' };

  beforeEach(() => {
    repos = createMemoryRepos();
    svc = new DashboardService(repos);
  });

  it('без клиник возвращает пустой список', async () => {
    expect(await svc.listClients(methodist)).toEqual([]);
  });

  it('клиника не может открыть каталог клиентов (нет clinic:read)', async () => {
    await expect(svc.listClients(nurse)).rejects.toThrow();
  });

  it('методист и менеджер оба видят каталог (оба имеют clinic:read)', async () => {
    await repos.tenants.upsert('7712345671', 'ООО «Медицина Плюс»');
    expect(await svc.listClients(methodist)).toHaveLength(1);
    expect(await svc.listClients(manager)).toHaveLength(1);
  });

  it('счётчики штата, оплаченных этапов и открытых CAPA считаются по клинике', async () => {
    await repos.tenants.upsert('7712345671', 'ООО «Медицина Плюс»');
    await repos.channels.set('tenant', '7712345671', 'staff', [{ fio: 'Петрова В. В.', pos: 'Медсестра' }], { updatedBy: null });
    const payments: Record<number, StagePaymentState> = {
      1: { status: 'paid', requestedAt: null, requestedBy: null, confirmedAt: null, confirmedBy: null, amount: 68000, accepted: false, acceptedAt: null, acceptedBy: null },
      2: { status: 'pending', requestedAt: null, requestedBy: null, confirmedAt: null, confirmedBy: null, amount: 68000, accepted: false, acceptedAt: null, acceptedBy: null },
    };
    await repos.channels.set('tenant', '7712345671', 'stage_paid', payments, { updatedBy: null });
    const capaItems: CapaItem[] = [
      { id: '1', sourceKind: 'walk', sourcePlanId: 'p1', sourceItemIndex: 0, auditName: 'A', object: '', findingText: 'x', comment: '', who: 'Y', due: '', status: 'planned', createdAt: '', createdBy: '', closedAt: null },
      { id: '2', sourceKind: 'walk', sourcePlanId: 'p1', sourceItemIndex: 1, auditName: 'A', object: '', findingText: 'x', comment: '', who: 'Y', due: '', status: 'done', createdAt: '', createdBy: '', closedAt: '' },
    ];
    await repos.channels.set('tenant', '7712345671', 'capa', capaItems, { updatedBy: null });

    const rows = await svc.listClients(methodist);
    expect(rows[0]).toMatchObject({ inn: '7712345671', name: 'ООО «Медицина Плюс»', staffCount: 1, stagesPaid: 1, openCapa: 1 });
  });

  it('несколько клиник — несколько строк', async () => {
    await repos.tenants.upsert('7712345671', 'ООО «Медицина Плюс»');
    await repos.tenants.upsert('5001007322', 'ИП Кузнецова');
    const rows = await svc.listClients(methodist);
    expect(rows.map((r) => r.inn).sort()).toEqual(['5001007322', '7712345671']);
  });
});

describe('DashboardService — финансовый дашборд (getFinancials)', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: DashboardService;
  const methodist = makeAccount('methodist');
  const nurse = { ...makeAccount('nurse'), side: 'clinic' as const, inn: '7712345671' };

  const TARIFFS: TariffDef[] = [
    { key: 'start', name: 'Старт', price: 15000, period: 'monthly', description: '', active: true },
    { key: 'pro-year', name: 'Про (год)', price: 240000, period: 'annual', description: '', active: true },
  ];

  function sub(patch: Partial<SubscriptionState>): SubscriptionState {
    return { tariffKey: null, status: 'none', startedAt: null, expiresAt: null, history: [], ...patch };
  }

  beforeEach(async () => {
    repos = createMemoryRepos();
    svc = new DashboardService(repos);
    await repos.channels.set('platform', null, 'tariffs', TARIFFS, { updatedBy: null });
  });

  it('без клиник — нулевая сводка, без деления на ноль', async () => {
    const f = await svc.getFinancials(methodist);
    expect(f).toEqual({ mrr: 0, arpa: 0, activeSubscriptions: 0, churnRate: 0, tariffDemand: [], avgRolloutDays: null });
  });

  it('исполнитель клиники не видит финансовый дашборд (нет money:read)', async () => {
    await expect(svc.getFinancials(nurse)).rejects.toThrow();
  });

  it('MRR и ARPA считаются по активным подпискам на месячный тариф', async () => {
    await repos.tenants.upsert('7712345671', 'Клиника 1');
    await repos.channels.set('tenant', '7712345671', 'subscription', sub({ tariffKey: 'start', status: 'active', history: [{ at: '01.01.2026', byId: 'x', action: 'assign', tariffKey: 'start' }] }), { updatedBy: null });
    const f = await svc.getFinancials(methodist);
    expect(f.mrr).toBe(15000);
    expect(f.arpa).toBe(15000);
    expect(f.activeSubscriptions).toBe(1);
  });

  it('годовой тариф пересчитывается в месячный эквивалент', async () => {
    await repos.tenants.upsert('7712345671', 'Клиника 1');
    await repos.channels.set('tenant', '7712345671', 'subscription', sub({ tariffKey: 'pro-year', status: 'trial', history: [{ at: '01.01.2026', byId: 'x', action: 'assign', tariffKey: 'pro-year' }] }), { updatedBy: null });
    const f = await svc.getFinancials(methodist);
    expect(f.mrr).toBe(20000); // 240000 / 12
  });

  it('отток — доля отменённых/истёкших среди когда-либо подписанных', async () => {
    await repos.tenants.upsert('7712345671', 'Клиника 1');
    await repos.tenants.upsert('5001007322', 'Клиника 2');
    await repos.channels.set('tenant', '7712345671', 'subscription', sub({ tariffKey: 'start', status: 'cancelled', history: [{ at: '01.01.2026', byId: 'x', action: 'assign', tariffKey: 'start' }] }), { updatedBy: null });
    await repos.channels.set('tenant', '5001007322', 'subscription', sub({ tariffKey: 'start', status: 'active', history: [{ at: '01.01.2026', byId: 'x', action: 'assign', tariffKey: 'start' }] }), { updatedBy: null });
    const f = await svc.getFinancials(methodist);
    expect(f.churnRate).toBe(0.5);
  });

  it('востребованность тарифов считает активные подписки по каждому тарифу, сортирует по убыванию', async () => {
    await repos.tenants.upsert('7712345671', 'Клиника 1');
    await repos.tenants.upsert('5001007322', 'Клиника 2');
    await repos.tenants.upsert('5610138059', 'Клиника 3');
    await repos.channels.set('tenant', '7712345671', 'subscription', sub({ tariffKey: 'start', status: 'active' }), { updatedBy: null });
    await repos.channels.set('tenant', '5001007322', 'subscription', sub({ tariffKey: 'start', status: 'active' }), { updatedBy: null });
    await repos.channels.set('tenant', '5610138059', 'subscription', sub({ tariffKey: 'pro-year', status: 'active' }), { updatedBy: null });
    const f = await svc.getFinancials(methodist);
    expect(f.tariffDemand).toEqual([
      { tariffKey: 'start', tariffName: 'Старт', count: 2 },
      { tariffKey: 'pro-year', tariffName: 'Про (год)', count: 1 },
    ]);
  });

  it('средний срок внедрения — от заказа первого этапа до приёмки последнего принятого', async () => {
    await repos.tenants.upsert('7712345671', 'Клиника 1');
    const payments: Record<number, StagePaymentState> = {
      1: { status: 'paid', requestedAt: '01.01.2026', requestedBy: null, confirmedAt: '02.01.2026', confirmedBy: null, amount: 68000, accepted: true, acceptedAt: '05.01.2026', acceptedBy: null },
      2: { status: 'paid', requestedAt: '06.01.2026', requestedBy: null, confirmedAt: '07.01.2026', confirmedBy: null, amount: 68000, accepted: true, acceptedAt: '16.01.2026', acceptedBy: null },
    };
    await repos.channels.set('tenant', '7712345671', 'stage_paid', payments, { updatedBy: null });
    const f = await svc.getFinancials(methodist);
    expect(f.avgRolloutDays).toBe(15); // 01.01 → 16.01
  });

  it('без принятых этапов срок внедрения не считается (null, а не 0)', async () => {
    await repos.tenants.upsert('7712345671', 'Клиника 1');
    const payments: Record<number, StagePaymentState> = {
      1: { status: 'pending', requestedAt: '01.01.2026', requestedBy: null, confirmedAt: null, confirmedBy: null, amount: 68000, accepted: false, acceptedAt: null, acceptedBy: null },
    };
    await repos.channels.set('tenant', '7712345671', 'stage_paid', payments, { updatedBy: null });
    const f = await svc.getFinancials(methodist);
    expect(f.avgRolloutDays).toBeNull();
  });
});
