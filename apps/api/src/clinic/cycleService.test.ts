import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { CycleService } from './cycleService.js';
import type { Account } from '../domain/types.js';
import type { AuditPlanItem, CycleMaster } from '../shared/channelShapes.js';

const inn = '7712345671';

function makeAccount(role: Account['role']): Account {
  return {
    id: 'acc_' + role, inn, login: role, phone: null, email: null, org: null,
    fio: 'Иванова М. А.', side: 'clinic', role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

const MASTER: CycleMaster = {
  year: 2026,
  dirs: [
    { name: 'Эпидемиологическая безопасность', months: [2, 8] },
    { name: 'Лекарственная безопасность', months: [5] },
  ],
  capaTerms: [{ level: 'критическое', days: 10 }],
};

describe('CycleService — разбор годового цикла клиникой', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: CycleService;
  const vkk = makeAccount('vkk_lead');
  const auditor = makeAccount('auditor');

  beforeEach(async () => {
    repos = createMemoryRepos();
    svc = new CycleService(repos);
    await repos.channels.set('platform', null, 'cycle_master', MASTER, { updatedBy: null });
  });

  it('без опубликованного эталона возвращает понятную ошибку', async () => {
    const empty = createMemoryRepos();
    const r = await new CycleService(empty).getMergedView(vkk);
    expect(r.ok).toBe(false);
  });

  it('без настройки клиники месяцы берутся из эталона как есть', async () => {
    const r = await svc.getMergedView(vkk);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dirs.find((d) => d.name === 'Эпидемиологическая безопасность')?.months).toEqual([2, 8]);
    }
  });

  it('аудитор может только читать (plan:read), но не настраивать направление', async () => {
    await expect(svc.customizeDirection(auditor, 'Эпидемиологическая безопасность', { who: 'Сидорова В. В.' })).rejects.toThrow();
  });

  it('vkk_lead настраивает направление — переопределяет месяцы и добавляет ответственного', async () => {
    const r = await svc.customizeDirection(vkk, 'Эпидемиологическая безопасность', { months: [3], who: 'Сидорова В. В.', check: 'Чек-лист аудита процедурного кабинета' });
    expect(r.ok).toBe(true);
    const merged = await svc.getMergedView(vkk);
    if (!merged.ok) throw new Error('setup');
    const d = merged.dirs.find((x) => x.name === 'Эпидемиологическая безопасность');
    expect(d?.months).toEqual([3]);
    expect(d?.who).toBe('Сидорова В. В.');
  });

  it('настройка неизвестного направления отклоняется', async () => {
    const r = await svc.customizeDirection(vkk, 'Несуществующее направление', { who: 'X' });
    expect(r.ok).toBe(false);
  });

  it('generatePlan создаёт по одной строке плана на каждый месяц каждого направления', async () => {
    const r = await svc.generatePlan(vkk);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.generated).toBe(3); // 2 месяца + 1 месяц

    const rec = await repos.channels.get<AuditPlanItem[]>('tenant', inn, 'audit_plan', []);
    const dates = rec.data.map((p) => p.date).sort();
    expect(dates).toEqual(['01.03.2026', '01.06.2026', '01.09.2026']);
  });

  it('повторная генерация не дублирует строки и подхватывает изменения настройки', async () => {
    await svc.generatePlan(vkk);
    await svc.customizeDirection(vkk, 'Лекарственная безопасность', { months: [0, 1] });
    const r = await svc.generatePlan(vkk);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.generated).toBe(4); // 2 + 2 месяца после правки

    const rec = await repos.channels.get<AuditPlanItem[]>('tenant', inn, 'audit_plan', []);
    expect(rec.data).toHaveLength(4); // не 3+4=7 — старые cyc-строки заменены, не накоплены
  });

  it('генерация цикла не трогает ручные записи плана (PlanService)', async () => {
    await repos.channels.set('tenant', inn, 'audit_plan', [{ id: 'manual-1', name: 'Ручная проверка', who: 'Петрова В. В.' }], { updatedBy: null });
    await svc.generatePlan(vkk);
    const rec = await repos.channels.get<AuditPlanItem[]>('tenant', inn, 'audit_plan', []);
    expect(rec.data.some((p) => p.id === 'manual-1')).toBe(true);
    expect(rec.data.length).toBe(4); // 1 ручная + 3 из цикла
  });

  it('тенант-изоляция: настройка одной клиники не видна другой', async () => {
    await svc.customizeDirection(vkk, 'Эпидемиологическая безопасность', { who: 'Сидорова В. В.' });
    const otherVkk = { ...vkk, inn: '5001007322' };
    const merged = await svc.getMergedView(otherVkk);
    if (!merged.ok) throw new Error('setup');
    expect(merged.dirs.find((d) => d.name === 'Эпидемиологическая безопасность')?.who).toBe('');
  });
});
