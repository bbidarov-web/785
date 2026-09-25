import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { DashboardService } from './dashboardService.js';
import { DocumentService } from '../documents/service.js';
import { todayString } from '../shared/date.js';
import type { Account } from '../domain/types.js';
import type { CapaItem, StagePaymentState, SubscriptionState, TariffDef } from '../shared/channelShapes.js';

function makeAccount(role: Account['role']): Account {
  return {
    id: 'acc_' + role, inn: '7726345678', login: role, phone: null, email: null, org: null,
    fio: 'Тест', side: 'platform', role, pending: false, requestedRole: null, branchName: null,
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
    svc = new DashboardService(repos, new DocumentService(repos));
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
      1: { status: 'paid', requestedAt: null, requestedBy: null, confirmedAt: null, confirmedBy: null, amount: 68000, accepted: false, acceptedAt: null, acceptedBy: null, offerAccepted: false, offerAcceptedAt: null, offerAcceptedBy: null },
      2: { status: 'pending', requestedAt: null, requestedBy: null, confirmedAt: null, confirmedBy: null, amount: 68000, accepted: false, acceptedAt: null, acceptedBy: null, offerAccepted: false, offerAcceptedAt: null, offerAcceptedBy: null },
    };
    await repos.channels.set('tenant', '7712345671', 'stage_paid', payments, { updatedBy: null });
    const capaItems: CapaItem[] = [
      { id: '1', sourceKind: 'walk', sourcePlanId: 'p1', sourceItemIndex: 0, auditName: 'A', object: '', findingText: 'x', comment: '', who: 'Y', due: '', severity: null, status: 'planned', createdAt: '', createdBy: '', closedAt: null, effectiveness: 'not_checked', effectivenessComment: '', effectivenessAt: null },
      { id: '2', sourceKind: 'walk', sourcePlanId: 'p1', sourceItemIndex: 1, auditName: 'A', object: '', findingText: 'x', comment: '', who: 'Y', due: '', severity: null, status: 'done', createdAt: '', createdBy: '', closedAt: '', effectiveness: 'not_checked', effectivenessComment: '', effectivenessAt: null },
    ];
    await repos.channels.set('tenant', '7712345671', 'capa', capaItems, { updatedBy: null });

    const rows = await svc.listClients(methodist);
    expect(rows[0]).toMatchObject({ inn: '7712345671', name: 'ООО «Медицина Плюс»', staffCount: 1, stagesPaid: 1, openCapa: 1 });
  });

  it('портфель считает обходы из реального формата канала (словарь planId → запись), а не падает', async () => {
    await repos.tenants.upsert('7712345671', 'Клиника');
    await repos.channels.set('tenant', '7712345671', 'walk_results', { p1: { planId: 'p1', date: todayString(), finished: true, items: [] } }, { updatedBy: null });
    const r = await svc.getPortfolio(methodist, 30);
    expect(r.auditsInPeriod).toBe(1);
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
    svc = new DashboardService(repos, new DocumentService(repos));
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
      1: { status: 'paid', requestedAt: '01.01.2026', requestedBy: null, confirmedAt: '02.01.2026', confirmedBy: null, amount: 68000, accepted: true, acceptedAt: '05.01.2026', acceptedBy: null, offerAccepted: false, offerAcceptedAt: null, offerAcceptedBy: null },
      2: { status: 'paid', requestedAt: '06.01.2026', requestedBy: null, confirmedAt: '07.01.2026', confirmedBy: null, amount: 68000, accepted: true, acceptedAt: '16.01.2026', acceptedBy: null, offerAccepted: false, offerAcceptedAt: null, offerAcceptedBy: null },
    };
    await repos.channels.set('tenant', '7712345671', 'stage_paid', payments, { updatedBy: null });
    const f = await svc.getFinancials(methodist);
    expect(f.avgRolloutDays).toBe(15); // 01.01 → 16.01
  });

  it('без принятых этапов срок внедрения не считается (null, а не 0)', async () => {
    await repos.tenants.upsert('7712345671', 'Клиника 1');
    const payments: Record<number, StagePaymentState> = {
      1: { status: 'pending', requestedAt: '01.01.2026', requestedBy: null, confirmedAt: null, confirmedBy: null, amount: 68000, accepted: false, acceptedAt: null, acceptedBy: null, offerAccepted: false, offerAcceptedAt: null, offerAcceptedBy: null },
    };
    await repos.channels.set('tenant', '7712345671', 'stage_paid', payments, { updatedBy: null });
    const f = await svc.getFinancials(methodist);
    expect(f.avgRolloutDays).toBeNull();
  });
});

describe('DashboardService — каталог клиентов: тариф, филиалы, готовность, активность, риск оттока', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: DashboardService;
  const methodist = makeAccount('methodist');
  const CATALOG = [{ code: 1, name: 'Этап 1', price: 1000, blocks: [{ key: 'b1', num: '01', name: 'Блок', docs: [{ name: 'Док 1', template: '' }, { name: 'Док 2', template: '' }] }] }];

  beforeEach(async () => {
    repos = createMemoryRepos();
    svc = new DashboardService(repos, new DocumentService(repos));
    await repos.tenants.upsert('7712345671', 'Клиника 1');
    await repos.channels.set('platform', null, 'stage_docs', CATALOG, { updatedBy: null });
    await repos.channels.set('platform', null, 'tariffs', [{ key: 'start', name: 'Старт', price: 15000, period: 'monthly', description: '', active: true }], { updatedBy: null });
  });

  it('без выдач готовность 0%, без подписки — тариф null и статус none', async () => {
    const rows = await svc.listClients(methodist);
    expect(rows[0]).toMatchObject({ readinessPct: 0, tariffKey: null, tariffName: null, subscriptionStatus: 'none', branchesCount: 0, lastActivityAt: null, churnRisk: false });
  });

  it('готовность считается как доля выданных документов от каталога', async () => {
    const doc = new DocumentService(repos);
    await doc.grant('7712345671', '1', 'Док 1', 'Док 1', { ...methodist }, true);
    const rows = await svc.listClients(methodist);
    expect(rows[0]?.readinessPct).toBe(50); // 1 из 2 документов каталога
  });

  it('филиалы и тариф подтягиваются из своих каналов', async () => {
    await repos.channels.set('tenant', '7712345671', 'branches', [{ id: 'b1', name: 'Филиал Юг' }, { id: 'b2', name: 'Филиал Север' }], { updatedBy: null });
    await repos.channels.set('tenant', '7712345671', 'subscription', { tariffKey: 'start', status: 'active', startedAt: '01.01.2026', expiresAt: '01.02.2026', history: [] }, { updatedBy: null });
    const rows = await svc.listClients(methodist);
    expect(rows[0]).toMatchObject({ branchesCount: 2, tariffKey: 'start', tariffName: 'Старт', subscriptionStatus: 'active' });
  });

  it('активность — самый поздний lastLoginAt среди сотрудников клиники', async () => {
    const acc = await repos.accounts.create({
      inn: '7712345671', login: 'clinicadmin', phone: null, email: null, org: null, fio: 'X', side: 'clinic', role: 'clinic_admin',
      pending: false, requestedRole: null, branchName: null, passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    });
    await repos.accounts.update(acc.id, { lastLoginAt: new Date('2026-03-05T10:00:00Z') });
    const rows = await svc.listClients(methodist);
    expect(rows[0]?.lastActivityAt).toBe('05.03.2026');
  });

  it('риск оттока: подписка истекла или отменена, либо истекает в ближайшие 14 дней', async () => {
    await repos.channels.set('tenant', '7712345671', 'subscription', { tariffKey: 'start', status: 'expired', startedAt: null, expiresAt: null, history: [] }, { updatedBy: null });
    expect((await svc.listClients(methodist))[0]?.churnRisk).toBe(true);
  });

  it('портфель считает клиник, MRR, среднюю готовность и обходы за период', async () => {
    await repos.channels.set('tenant', '7712345671', 'subscription', { tariffKey: 'start', status: 'active', startedAt: null, expiresAt: null, history: [] }, { updatedBy: null });
    await repos.channels.set('tenant', '7712345671', 'walk_results', [{ date: todayString() }, { date: '01.01.2020' }], { updatedBy: null });
    const portfolio = await svc.getPortfolio(methodist, 30);
    expect(portfolio).toMatchObject({ clinicsCount: 1, mrr: 15000, auditsInPeriod: 1, periodDays: 30 });
  });

  it('CSV-экспорт включает шапку и строку клиники', async () => {
    const csv = await svc.exportClientsCsv(methodist);
    expect(csv).toContain('ИНН');
    expect(csv).toContain('7712345671');
    expect(csv).toContain('Клиника 1');
  });
});
