import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { DashboardService } from './dashboardService.js';
import type { Account } from '../domain/types.js';
import type { CapaItem, StagePaymentState } from '../shared/channelShapes.js';

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
      1: { status: 'paid', requestedAt: null, requestedBy: null, confirmedAt: null, confirmedBy: null, amount: 68000 },
      2: { status: 'pending', requestedAt: null, requestedBy: null, confirmedAt: null, confirmedBy: null, amount: 68000 },
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
