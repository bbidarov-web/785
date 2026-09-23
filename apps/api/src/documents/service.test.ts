import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { DocumentService } from './service.js';
import type { Account } from '../domain/types.js';

function makeAccount(patch: Partial<Account>): Account {
  return {
    id: 'acc_op', inn: '7726345678', login: 'metodist', phone: null, email: null, org: null,
    fio: 'Николаева Е. В.', side: 'platform', role: 'methodist', pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
    ...patch,
  };
}

describe('DocumentService — выдача документов (README, SERVER.md §5)', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: DocumentService;
  const tenant = '7712345671';
  const by = makeAccount({});

  beforeEach(() => {
    repos = createMemoryRepos();
    svc = new DocumentService(repos);
  });

  it('невыданный документ не отдаётся — даже по прямому запросу к сервису', async () => {
    const r = await svc.getTemplateIfGranted(tenant, 'DOC-1', async () => 'шаблон');
    expect(r.ok).toBe(false);
  });

  it('после выдачи документ отдаётся', async () => {
    await svc.grant(tenant, 'stage-1', 'DOC-1', 'Положение о ВКК', by, true);
    const r = await svc.getTemplateIfGranted(tenant, 'DOC-1', async () => 'шаблон');
    expect(r.ok).toBe(true);
  });

  it('отзыв выдачи снова закрывает доступ', async () => {
    await svc.grant(tenant, 'stage-1', 'DOC-1', 'Положение о ВКК', by, true);
    await svc.revoke(tenant, 'stage-1', 'DOC-1', 'Положение о ВКК', by);
    const r = await svc.getTemplateIfGranted(tenant, 'DOC-1', async () => 'шаблон');
    expect(r.ok).toBe(false);
  });

  it('каждая выдача и отзыв — отдельная запись в журнале действий', async () => {
    await svc.grant(tenant, 'stage-1', 'DOC-1', 'Положение о ВКК', by, true);
    await svc.revoke(tenant, 'stage-1', 'DOC-1', 'Положение о ВКК', by);
    const log = await repos.auditLog.list({ tenantInn: tenant });
    expect(log.filter((l) => l.action === 'document:grant')).toHaveLength(1);
    expect(log.filter((l) => l.action === 'document:revoke')).toHaveLength(1);
  });

  it('выдача документа клинике из другого арендатора не путается по коду', async () => {
    const otherTenant = '5001007322';
    await svc.grant(tenant, 'stage-1', 'DOC-1', 'Положение о ВКК', by, true);
    const r = await svc.getTemplateIfGranted(otherTenant, 'DOC-1', async () => 'шаблон');
    expect(r.ok).toBe(false);
  });

  it('listActiveGrants возвращает только активные (не отозванные) выдачи', async () => {
    await svc.grant(tenant, 'stage-1', 'DOC-1', 'A', by, true);
    await svc.grant(tenant, 'stage-1', 'DOC-2', 'B', by, true);
    await svc.revoke(tenant, 'stage-1', 'DOC-1', 'A', by);
    const active = await svc.listActiveGrants(tenant);
    expect(Object.keys(active)).toEqual(['DOC-2']);
  });
});
