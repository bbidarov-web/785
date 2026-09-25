import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { ReadinessService } from './readinessService.js';
import { addDays, todayString } from '../shared/date.js';
import type { Account } from '../domain/types.js';

const inn = '7712345671';
const admin: Account = {
  id: 'acc_admin', inn, login: 'a', phone: null, email: null, org: null, fio: 'Админ', side: 'clinic', role: 'clinic_admin',
  pending: false, requestedRole: null, branchName: null, passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
  createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
};

describe('ReadinessService — готовность к проверке с раскладкой по причинам', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: ReadinessService;
  beforeEach(() => { repos = createMemoryRepos(); svc = new ReadinessService(repos); });

  it('пустая клиника: каждый недостающий балл объяснён строкой, документы без каталога не участвуют', async () => {
    const r = await svc.get(admin);
    expect(r.lines.find((l) => l.key === 'docs')).toBeUndefined();
    for (const l of r.lines.filter((l) => l.earned < l.weight)) expect(l.reason).not.toBe('');
    expect(r.percent).toBeLessThan(50);
  });

  it('документы: процент растёт с выдачей, причина называет число и первые документы', async () => {
    await repos.channels.set('platform', null, 'stage_docs', [{ code: 1, name: 'Э1', price: 1, blocks: [{ key: 'b', num: '1', name: 'Б', docs: [{ name: 'Док А', template: '' }, { name: 'Док Б', template: '' }] }] }], { updatedBy: null });
    const before = (await svc.get(admin)).lines.find((l) => l.key === 'docs')!;
    expect(before.earned).toBe(0);
    expect(before.reason).toContain('не выдано 2 из 2');
    await repos.documentGrants.appendEvent({ tenantInn: inn, stage: '1', code: 'Док А', name: 'Док А', event: 'grant', byAccountId: 'x', byRole: 'methodist', paid: true });
    const after = (await svc.get(admin)).lines.find((l) => l.key === 'docs')!;
    expect(after.earned).toBe(17.5);
  });

  it('просроченная непроведённая проверка обнуляет пункт «в срок», проведённая — нет', async () => {
    await repos.channels.set('tenant', inn, 'audit_plan', [{ id: 'p1', name: 'Стерилизационная', date: addDays(todayString(), -3), who: 'X' }], { updatedBy: null });
    expect((await svc.get(admin)).lines.find((l) => l.key === 'plan-overdue')!.earned).toBe(0);
    await repos.channels.set('tenant', inn, 'walk_results', { p1: { planId: 'p1', finished: true, items: [] } }, { updatedBy: null });
    expect((await svc.get(admin)).lines.find((l) => l.key === 'plan-overdue')!.earned).toBe(15);
  });

  it('нарушение без мероприятия снижает «разобраны», заведённое мероприятие — восстанавливает', async () => {
    await repos.channels.set('tenant', inn, 'walk_results', { p1: { planId: 'p1', finished: true, items: [{ text: 'x', answer: 'bad', comment: '', photoFileId: null }] } }, { updatedBy: null });
    expect((await svc.get(admin)).lines.find((l) => l.key === 'findings')!.earned).toBe(0);
    await repos.channels.set('tenant', inn, 'capa', [{ id: 'c', sourceKind: 'walk', sourcePlanId: 'p1', sourceItemIndex: 0, status: 'planned', due: '' }], { updatedBy: null });
    expect((await svc.get(admin)).lines.find((l) => l.key === 'findings')!.earned).toBe(10);
  });

  it('тенант-изоляция: чужая клиника не влияет на оценку', async () => {
    await repos.channels.set('tenant', '5001007322', 'staff', [{ fio: 'Х', pos: '' }], { updatedBy: null });
    expect((await svc.get(admin)).lines.find((l) => l.key === 'staff')!.earned).toBe(0);
  });
});
