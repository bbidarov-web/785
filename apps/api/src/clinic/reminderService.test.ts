import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { ReminderService } from './reminderService.js';
import { addDays, todayString } from '../shared/date.js';

const inn = '7712345671';

describe('ReminderService — напоминания и эскалация по срокам', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: ReminderService;

  async function person(login: string, role: 'nurse' | 'clinic_admin' | 'vkk_lead', fio: string, email: string | null, phone: string | null = null) {
    await repos.accounts.create({
      inn, login, phone, email, org: null, fio, side: 'clinic', role, pending: false, requestedRole: null, branchName: null,
      passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    });
  }
  const setPlan = (date: string, extra: object = {}) =>
    repos.channels.set('tenant', inn, 'audit_plan', [{ id: 'p1', name: 'Проверка стерилизационной', date, who: 'Петрова В. В. · Медсестра', ...extra }], { updatedBy: null });

  beforeEach(async () => {
    repos = createMemoryRepos();
    svc = new ReminderService(repos);
    await repos.tenants.upsert(inn, 'Клиника 1');
    await person('nurse', 'nurse', 'Петрова В. В.', 'petrova@x.ru');
    await person('admin', 'clinic_admin', 'Смирнов А. П.', null, '+79160000001');
  });

  it('за 3 дня до срока напоминание получает только исполнитель', async () => {
    await setPlan(addDays(todayString(), 3));
    expect(await svc.run()).toBe(1);
    expect(repos.notifier.sentReminders).toEqual([expect.objectContaining({ via: 'email', to: 'petrova@x.ru' })]);
  });

  it('в день срока — исполнителю и руководству (у админа только телефон → смс)', async () => {
    await setPlan(todayString());
    await svc.run();
    expect(repos.notifier.sentReminders.map((r) => r.to).sort()).toEqual(['+79160000001', 'petrova@x.ru']);
  });

  it('просрочка: эскалация только руководству, на 1-й, 3-й и 7-й день', async () => {
    await setPlan(addDays(todayString(), -1));
    await svc.run();
    expect(repos.notifier.sentReminders).toEqual([expect.objectContaining({ to: '+79160000001', subject: expect.stringContaining('просрочена') })]);
    await setPlan(addDays(todayString(), -2)); // 2-й день — вехи нет
    expect(await svc.run()).toBe(0);
  });

  it('повторный проход в тот же день ничего не шлёт (идемпотентно)', async () => {
    await setPlan(addDays(todayString(), 3));
    await svc.run();
    expect(await svc.run()).toBe(0);
    expect(repos.notifier.sentReminders).toHaveLength(1);
  });

  it('уже проведённая проверка не напоминает', async () => {
    await setPlan(todayString());
    await repos.channels.set('tenant', inn, 'walk_results', { p1: { finished: true } }, { updatedBy: null });
    expect(await svc.run()).toBe(0);
  });

  it('мероприятие CAPA: за 3 дня исполнителю; выполненное — не напоминает', async () => {
    const capa = { id: 'c1', findingText: 'Индикаторы', who: 'Петрова В. В.', due: addDays(todayString(), 3), status: 'planned' };
    await repos.channels.set('tenant', inn, 'capa', [capa], { updatedBy: null });
    expect(await svc.run()).toBe(1);
    await repos.channels.set('tenant', inn, 'capa', [{ ...capa, id: 'c2', status: 'done' }], { updatedBy: null });
    expect(await svc.run()).toBe(0);
  });

  it('исполнитель без контактов — пропускается без ошибки', async () => {
    await repos.channels.set('tenant', inn, 'audit_plan', [{ id: 'p9', name: 'X', date: addDays(todayString(), 3), who: 'Неизвестный Н. Н.' }], { updatedBy: null });
    expect(await svc.run()).toBe(0);
  });
});
