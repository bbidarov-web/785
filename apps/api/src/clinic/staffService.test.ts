import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { StaffService } from './staffService.js';
import type { Account } from '../domain/types.js';

const inn = '7712345671';

function makeAccount(role: Account['role'], fio = 'Смирнов А. П.'): Account {
  return {
    id: 'acc_' + role, inn, login: role, phone: null, email: null, org: null,
    fio, side: 'clinic', role, pending: false, requestedRole: null, branchName: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

describe('StaffService — сотрудники и матрица ответственных', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: StaffService;
  const admin = makeAccount('clinic_admin');
  const vkk = makeAccount('vkk_lead', 'Иванова М. А.');
  const nurse = makeAccount('nurse', 'Петрова В. В.');

  beforeEach(() => {
    repos = createMemoryRepos();
    svc = new StaffService(repos);
  });

  it('clinic_admin добавляет сотрудника, список сразу виден', async () => {
    const r = await svc.upsert(admin, { fio: 'Петрова В. В.', pos: 'Старшая медсестра' });
    expect(r.ok).toBe(true);
    const list = await svc.list(admin);
    expect(list).toEqual([{ fio: 'Петрова В. В.', pos: 'Старшая медсестра' }]);
  });

  it('vkk_lead не может управлять штатом (нет staff:manage)', async () => {
    await expect(svc.upsert(vkk, { fio: 'X', pos: 'Y' })).rejects.toThrow();
  });

  it('исполнитель не может читать даже список (нет doc:read... на самом деле есть — читает свободно)', async () => {
    // у nurse ЕСТЬ doc:read — список читать можно, только не редактировать
    await svc.upsert(admin, { fio: 'Петрова В. В.', pos: 'Старшая медсестра' });
    const list = await svc.list(nurse);
    expect(list).toHaveLength(1);
    await expect(svc.upsert(nurse, { fio: 'Y', pos: 'Z' })).rejects.toThrow();
  });

  it('повторный upsert с тем же ФИО заменяет запись, а не дублирует', async () => {
    await svc.upsert(admin, { fio: 'Петрова В. В.', pos: 'Медсестра' });
    await svc.upsert(admin, { fio: 'Петрова В. В.', pos: 'Старшая медсестра' });
    const list = await svc.list(admin);
    expect(list).toEqual([{ fio: 'Петрова В. В.', pos: 'Старшая медсестра' }]);
  });

  it('remove убирает сотрудника из списка', async () => {
    await svc.upsert(admin, { fio: 'Петрова В. В.', pos: 'Медсестра' });
    await svc.remove(admin, 'Петрова В. В.');
    expect(await svc.list(admin)).toEqual([]);
  });

  it('vkk_lead может назначить ответственного за документ (doc:write)', async () => {
    const r = await svc.setAssignment(vkk, 'Положение о ВКК', 'Петрова В. В.');
    expect(r.ok).toBe(true);
    expect(await svc.listAssignments(admin)).toEqual({ 'Положение о ВКК': 'Петрова В. В.' });
  });

  it('исполнитель не может назначать ответственных (нет doc:write)', async () => {
    await expect(svc.setAssignment(nurse, 'Документ', 'Кто-то')).rejects.toThrow();
  });

  it('пустое значение снимает назначение', async () => {
    await svc.setAssignment(admin, 'Документ', 'Петрова В. В.');
    await svc.setAssignment(admin, 'Документ', '');
    expect(await svc.listAssignments(admin)).toEqual({});
  });

  it('тенант-изоляция: сотрудники одной клиники не видны в другой', async () => {
    await svc.upsert(admin, { fio: 'Петрова В. В.', pos: 'Медсестра' });
    const otherAdmin = { ...admin, inn: '5001007322' };
    expect(await svc.list(otherAdmin)).toEqual([]);
  });

  it('отметка «Выполнено» исполнителя видна администрации клиники в прогрессе по документам', async () => {
    const acc = await repos.accounts.create({
      inn, login: 'petrova', phone: null, email: null, org: null, fio: 'Петрова В. В.', side: 'clinic', role: 'nurse',
      pending: false, requestedRole: null, branchName: null, passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    });
    await repos.channels.set('tenant', inn, 'docasg', { 'Положение о ВКК': 'Петрова В. В. + Другая Д. Д.' }, { updatedBy: null });
    expect(await svc.listDocProgress(admin)).toEqual({});
    await repos.executorMarks.markDone(acc.id, 'doc|Положение о ВКК', 'Положение о ВКК');
    const progress = await svc.listDocProgress(admin);
    expect(progress['Положение о ВКК']).toHaveLength(1);
    expect(progress['Положение о ВКК']![0]!.fio).toBe('Петрова В. В.');
  });
});
