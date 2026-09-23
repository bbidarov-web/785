import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { SecondHandService } from './service.js';

describe('SecondHandService — вторая рука (SERVER.md §4)', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: SecondHandService;

  beforeEach(() => {
    repos = createMemoryRepos();
    svc = new SecondHandService(repos);
  });

  it('своей же рукой подтвердить нельзя', async () => {
    const req = await svc.request('role:elevate', { accountId: 'acc_2', newRole: 'platform_admin' }, null, 'acc_1');
    const apply = vi.fn(async () => 'done');
    const r = await svc.confirm(req.id, 'acc_1', apply);
    expect(r.ok).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('другой сотрудник подтверждает и применяется эффект ровно один раз', async () => {
    const req = await svc.request('tariff:delete', { tariffId: 't1' }, null, 'acc_1');
    const apply = vi.fn(async () => 'deleted');
    const r = await svc.confirm(req.id, 'acc_2', apply);
    expect(r.ok).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('повторное подтверждение уже обработанного запроса отклоняется', async () => {
    const req = await svc.request('tariff:delete', {}, null, 'acc_1');
    await svc.confirm(req.id, 'acc_2', async () => null);
    const second = await svc.confirm(req.id, 'acc_3', async () => null);
    expect(second.ok).toBe(false);
  });

  it('просроченный запрос не подтверждается', async () => {
    const req = await svc.request('bulk:clinics', {}, null, 'acc_1');
    repos.clock.advanceMs(25 * 60 * 60 * 1000); // 25 часов > TTL в 24 часа
    const r = await svc.confirm(req.id, 'acc_2', async () => null);
    expect(r.ok).toBe(false);
  });

  it('reject помечает запрос отклонённым, confirm после этого невозможен', async () => {
    const req = await svc.request('money:confirm', {}, null, 'acc_1');
    const rejected = await svc.reject(req.id, 'acc_2');
    expect(rejected.ok).toBe(true);
    const confirm = await svc.confirm(req.id, 'acc_3', async () => null);
    expect(confirm.ok).toBe(false);
  });
});
