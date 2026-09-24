import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { ExecutorService } from './service.js';
import type { Account } from '../domain/types.js';

const inn = '7712345671';

function makeNurse(fio: string): Account {
  return {
    id: 'acc_' + fio, inn, login: fio.toLowerCase(), phone: '+79160000000', email: null, org: 'ООО «Медицина Плюс»',
    fio, side: 'clinic', role: 'nurse', pending: false, requestedRole: null, branchName: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

describe('ExecutorService — «видит только то, где назначен» (README)', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: ExecutorService;
  const petrova = makeNurse('Петрова В. В.');
  const sidorova = makeNurse('Сидорова В. В.');

  beforeEach(async () => {
    repos = createMemoryRepos();
    svc = new ExecutorService(repos);
    await repos.channels.set('tenant', inn, 'docasg', {
      'Положение о ВКК': 'Петрова В. В.',
      'Инструкция по СОП-1': 'Сидорова В. В. + Петрова В. В.',
      'Приказ о комиссии': 'Сидорова В. В.',
    }, { updatedBy: null });
    await repos.channels.set('tenant', inn, 'audit_plan', [
      { name: 'Проверка А', object: 'Кабинет №1', kind: 'плановая', date: '01.03.2026', who: 'Петрова В. В.' },
      { name: 'Проверка Б', object: 'Кабинет №2', kind: 'внеплановая', date: '02.03.2026', who: 'Сидорова В. В.' },
    ], { updatedBy: null });
  });

  it('исполнитель видит только свои документы, включая совместные назначения через "+"', async () => {
    const overview = await svc.getOverview(petrova);
    const names = overview.docs.map((d) => d.name).sort();
    expect(names).toEqual(['Инструкция по СОП-1', 'Положение о ВКК']);
    const shared = overview.docs.find((d) => d.name === 'Инструкция по СОП-1');
    expect(shared?.together).toEqual(['Сидорова В. В.']);
  });

  it('чужой документ не попадает в список', async () => {
    const overview = await svc.getOverview(petrova);
    expect(overview.docs.some((d) => d.name === 'Приказ о комиссии')).toBe(false);
  });

  it('другой исполнитель видит свой независимый набор', async () => {
    const overview = await svc.getOverview(sidorova);
    const names = overview.docs.map((d) => d.name).sort();
    expect(names).toEqual(['Инструкция по СОП-1', 'Приказ о комиссии']);
  });

  it('проверки фильтруются по полю "who" плана проверок', async () => {
    const overview = await svc.getOverview(petrova);
    expect(overview.checks.map((c) => c.name)).toEqual(['Проверка А']);
  });

  it('markDocDone отмечает документ выполненным только для этого исполнителя', async () => {
    await svc.markDocDone(petrova, 'Положение о ВКК');
    const afterPetrova = await svc.getOverview(petrova);
    const afterSidorova = await svc.getOverview(sidorova);
    expect(afterPetrova.docs.find((d) => d.name === 'Положение о ВКК')?.done).toBe(true);
    // у Сидоровой этого документа вообще нет в списке — но метка не должна течь между исполнителями
    expect(afterSidorova.docs.find((d) => d.name === 'Положение о ВКК')).toBeUndefined();
  });

  it('не-исполнитель не может открыть обзор кабинета исполнителя', async () => {
    const clinicAdmin: Account = { ...petrova, role: 'clinic_admin' };
    await expect(svc.getOverview(clinicAdmin)).rejects.toThrow();
  });
});
