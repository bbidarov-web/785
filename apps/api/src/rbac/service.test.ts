import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { assertPermission, assertTenantScope, PermissionDeniedError } from './service.js';
import type { Account } from '../domain/types.js';

function makeAccount(patch: Partial<Account>): Account {
  return {
    id: 'acc_1', inn: '7712345671', login: 'x', phone: null, email: null, org: null,
    fio: 'Тест Тестов', side: 'clinic', role: 'nurse', pending: false, requestedRole: null, branchName: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
    ...patch,
  };
}

describe('RBAC', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  beforeEach(() => { repos = createMemoryRepos(); });

  it('пропускает действие, разрешённое роли', async () => {
    const acc = makeAccount({ role: 'clinic_admin' });
    await expect(assertPermission(repos.auditLog, acc, 'doc:write', 'doc:edit', 'x', acc.inn)).resolves.toBeUndefined();
  });

  it('бросает PermissionDeniedError и пишет отказ в журнал', async () => {
    const acc = makeAccount({ role: 'nurse' }); // nurse не имеет doc:write
    await expect(assertPermission(repos.auditLog, acc, 'doc:write', 'doc:edit', 'x', acc.inn)).rejects.toBeInstanceOf(PermissionDeniedError);
    const log = await repos.auditLog.list({ actorId: acc.id });
    expect(log).toHaveLength(1);
    expect(log[0]?.allowed).toBe(false);
  });

  it('методист не может подтвердить оплату (money:write) — разделение полномочий платформы', async () => {
    const acc = makeAccount({ role: 'methodist', side: 'platform' });
    await expect(assertPermission(repos.auditLog, acc, 'money:write', 'sub:confirm', 'x', null)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('assertTenantScope запрещает сотруднику клиники доступ к чужому ИНН', () => {
    const acc = makeAccount({ side: 'clinic', inn: '7712345671' });
    expect(() => assertTenantScope(acc, '7712345671')).not.toThrow();
    expect(() => assertTenantScope(acc, '9999999999')).toThrow(PermissionDeniedError);
  });

  it('assertTenantScope не ограничивает сотрудника платформы', () => {
    const acc = makeAccount({ side: 'platform', role: 'platform_admin', inn: '7726345678' });
    expect(() => assertTenantScope(acc, '7712345671')).not.toThrow();
  });
});
