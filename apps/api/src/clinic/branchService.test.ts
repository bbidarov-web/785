import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { BranchService } from './branchService.js';
import type { Account } from '../domain/types.js';

const inn = '7712345671';

function makeAccount(role: Account['role']): Account {
  return {
    id: 'acc_' + role, inn, login: role, phone: null, email: null, org: null,
    fio: 'Смирнов А. П.', side: 'clinic', role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

describe('BranchService — филиалы клиники', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: BranchService;
  const admin = makeAccount('clinic_admin');
  const vkk = makeAccount('vkk_lead');

  beforeEach(() => {
    repos = createMemoryRepos();
    svc = new BranchService(repos);
  });

  it('clinic_admin добавляет филиал (org:write)', async () => {
    const r = await svc.upsert(admin, 'Головная клиника');
    expect(r.ok).toBe(true);
    const list = await svc.list(admin);
    expect(list.map((b) => b.name)).toEqual(['Головная клиника']);
  });

  it('vkk_lead не может управлять филиалами (нет org:write)', async () => {
    await expect(svc.upsert(vkk, 'Филиал №2')).rejects.toThrow();
  });

  it('пустое название отклоняется', async () => {
    const r = await svc.upsert(admin, '   ');
    expect(r.ok).toBe(false);
  });

  it('remove удаляет филиал, повторный remove — ошибка', async () => {
    const created = await svc.upsert(admin, 'Филиал №2');
    if (!created.ok) throw new Error('setup');
    const r1 = await svc.remove(admin, created.branch.id);
    expect(r1.ok).toBe(true);
    const r2 = await svc.remove(admin, created.branch.id);
    expect(r2.ok).toBe(false);
  });

  it('тенант-изоляция: филиалы одной клиники не видны в другой', async () => {
    await svc.upsert(admin, 'Головная клиника');
    const otherAdmin = { ...admin, inn: '5001007322' };
    expect(await svc.list(otherAdmin)).toEqual([]);
  });
});
