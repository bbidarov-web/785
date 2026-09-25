import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { PlanService } from './planService.js';
import type { Account } from '../domain/types.js';

const inn = '7712345671';

function makeAccount(role: Account['role']): Account {
  return {
    id: 'acc_' + role, inn, login: role, phone: null, email: null, org: null,
    fio: 'Иванова М. А.', side: 'clinic', role, pending: false, requestedRole: null, branchName: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

describe('PlanService — план проверок', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: PlanService;
  const vkk = makeAccount('vkk_lead');
  const observer = makeAccount('observer');
  const auditor = makeAccount('auditor');

  beforeEach(() => {
    repos = createMemoryRepos();
    svc = new PlanService(repos);
  });

  it('vkk_lead создаёт проверку, наблюдатель может её прочитать (plan:read есть у обоих)', async () => {
    const r = await svc.create(vkk, { date: '01.03.2026', dir: 'Чек-лист аудита стерилизационной', object: 'Стерилизационная', who: 'Сидорова В. В.', kind: 'плановая' });
    expect(r.ok).toBe(true);
    const list = await svc.list(observer);
    expect(list).toHaveLength(1);
    expect(list[0]?.object).toBe('Стерилизационная');
  });

  it('аудитор не может создавать проверки (нет plan:write)', async () => {
    await expect(svc.create(auditor, { date: '01.03.2026', dir: 'X', object: 'Y', who: 'Z', kind: 'плановая' })).rejects.toThrow();
  });

  it('дата из <input type=date> (ГГГГ-ММ-ДД) хранится как ДД.ММ.ГГГГ; мусорная — ошибка', async () => {
    const ok = await svc.create(vkk, { date: '2026-03-15', dir: 'ЧЛ', object: 'Y', who: 'Z', kind: 'плановая' });
    expect(ok.ok && ok.item.date).toBe('15.03.2026');
    const bad = await svc.create(vkk, { date: 'завтра', dir: 'ЧЛ', object: 'Y', who: 'Z', kind: 'плановая' });
    expect(bad.ok).toBe(false);
  });

  it('пустое направление контроля отклоняется', async () => {
    const r = await svc.create(vkk, { date: '01.03.2026', dir: '  ', object: 'Y', who: 'Z', kind: 'плановая' });
    expect(r.ok).toBe(false);
  });

  it('update меняет только переданные поля, остальные сохраняются', async () => {
    const created = await svc.create(vkk, { date: '01.03.2026', dir: 'ЧЛ', object: 'Кабинет №1', who: 'Петрова В. В.', kind: 'плановая' });
    if (!created.ok) throw new Error('setup');
    const updated = await svc.update(vkk, created.item.id, { who: 'Сидорова В. В.' });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.item.who).toBe('Сидорова В. В.');
      expect(updated.item.object).toBe('Кабинет №1'); // не тронуто
    }
  });

  it('update несуществующей записи возвращает понятную ошибку', async () => {
    const r = await svc.update(vkk, 'ghost', { who: 'X' });
    expect(r.ok).toBe(false);
  });

  it('remove удаляет запись, повторное remove — ошибка', async () => {
    const created = await svc.create(vkk, { date: '01.03.2026', dir: 'ЧЛ', object: 'Кабинет №1', who: 'Петрова В. В.', kind: 'плановая' });
    if (!created.ok) throw new Error('setup');
    const r1 = await svc.remove(vkk, created.item.id);
    expect(r1.ok).toBe(true);
    const r2 = await svc.remove(vkk, created.item.id);
    expect(r2.ok).toBe(false);
    expect(await svc.list(vkk)).toEqual([]);
  });

  it('созданная запись сразу читаема обходом через тот же канал audit_plan', async () => {
    await svc.create(vkk, { date: '01.03.2026', dir: 'Чек-лист аудита стерилизационной', object: 'Стерилизационная', who: 'Сидорова В. В.', kind: 'плановая', check: 'Чек-лист аудита стерилизационной' });
    const raw = await repos.channels.get('tenant', inn, 'audit_plan', []);
    expect((raw.data as unknown[]).length).toBe(1);
  });

  it('тенант-изоляция: проверка одной клиники не видна в другой', async () => {
    await svc.create(vkk, { date: '01.03.2026', dir: 'ЧЛ', object: 'X', who: 'Y', kind: 'плановая' });
    const otherVkk = { ...vkk, inn: '5001007322' };
    expect(await svc.list(otherVkk)).toEqual([]);
  });

  describe('изоляция по филиалу (account.branchName)', () => {
    it('аудитор без привязки к филиалу видит весь план клиники', async () => {
      await svc.create(vkk, { date: '01.03.2026', dir: 'A', object: 'X', branch: 'Филиал 1', who: 'Y', kind: 'плановая' });
      await svc.create(vkk, { date: '01.03.2026', dir: 'B', object: 'X', branch: 'Филиал 2', who: 'Y', kind: 'плановая' });
      expect(await svc.list(auditor)).toHaveLength(2);
    });

    it('аудитор, закреплённый за филиалом, видит только свой филиал и записи без филиала', async () => {
      await svc.create(vkk, { date: '01.03.2026', dir: 'A', object: 'X', branch: 'Филиал 1', who: 'Y', kind: 'плановая' });
      await svc.create(vkk, { date: '01.03.2026', dir: 'B', object: 'X', branch: 'Филиал 2', who: 'Y', kind: 'плановая' });
      await svc.create(vkk, { date: '01.03.2026', dir: 'C', object: 'X', who: 'Y', kind: 'плановая' }); // без филиала — видна всем
      const scoped = { ...auditor, branchName: 'Филиал 1' };
      const list = await svc.list(scoped);
      expect(list.map((p) => p.dir).sort()).toEqual(['A', 'C']);
    });

    it('vkk_lead, закреплённый за филиалом, тоже видит только свой филиал — правило не зависит от роли', async () => {
      await svc.create(vkk, { date: '01.03.2026', dir: 'A', object: 'X', branch: 'Филиал 1', who: 'Y', kind: 'плановая' });
      await svc.create(vkk, { date: '01.03.2026', dir: 'B', object: 'X', branch: 'Филиал 2', who: 'Y', kind: 'плановая' });
      const scopedVkk = { ...vkk, branchName: 'Филиал 2' };
      const list = await svc.list(scopedVkk);
      expect(list.map((p) => p.dir)).toEqual(['B']);
    });
  });
});
