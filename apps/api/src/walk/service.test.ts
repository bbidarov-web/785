import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { WalkService } from './service.js';
import type { Account } from '../domain/types.js';
import type { AuditPlanItem, ChecklistDef } from '../shared/channelShapes.js';

const inn = '7712345671';

function makeAccount(role: Account['role'], fio: string): Account {
  return {
    id: 'acc_' + fio, inn, login: fio.toLowerCase(), phone: null, email: null, org: 'ООО «Медицина Плюс»',
    fio, side: 'clinic', role, pending: false, requestedRole: null, branchName: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

const CATALOG: ChecklistDef[] = [
  { name: 'Чек-лист аудита процедурного кабинета', items: ['Пункт 1', 'Пункт 2', 'Пункт 3'] },
  { name: 'Чек-лист аудита стерилизационной', items: ['Пункт A', 'Пункт B'] },
];

describe('WalkService — мобильный обход (README, SERVER.md §6.5)', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: WalkService;
  const auditor = makeAccount('auditor', 'Сидорова В. В.');
  const other = makeAccount('nurse', 'Петрова В. В.');

  beforeEach(async () => {
    repos = createMemoryRepos();
    svc = new WalkService(repos);
    await repos.channels.set('platform', null, 'checklists', CATALOG, { updatedBy: null });
  });

  async function seedPlan(items: AuditPlanItem[]) {
    await repos.channels.set('tenant', inn, 'audit_plan', items, { updatedBy: null });
  }

  it('видит только проверки, назначенные ему (isMine по who)', async () => {
    await seedPlan([
      { id: 'p1', check: 'Чек-лист аудита процедурного кабинета', who: 'Сидорова В. В.', object: 'Кабинет №1', kind: 'плановая', date: '01.03.2026' },
      { id: 'p2', check: 'Чек-лист аудита стерилизационной', who: 'Петрова В. В.', object: 'Стерилизационная', kind: 'плановая', date: '02.03.2026' },
    ]);
    const list = await svc.listAssigned(auditor);
    expect(list.map((w) => w.planId)).toEqual(['p1']);
  });

  it('сопоставляет чек-лист по точному имени и подтягивает пункты', async () => {
    await seedPlan([{ id: 'p1', check: 'Чек-лист аудита процедурного кабинета', who: 'Сидорова В. В.', object: 'Кабинет №1' }]);
    const list = await svc.listAssigned(auditor);
    expect(list[0]?.total).toBe(3);
    expect(list[0]?.noCheck).toBe(false);
  });

  it('сопоставляет чек-лист по нормализованному имени (кавычки, регистр, префикс блока)', async () => {
    await seedPlan([{ id: 'p1', check: '2 · "ЧЕК-ЛИСТ   Аудита Процедурного Кабинета"', who: 'Сидорова В. В.' }]);
    const list = await svc.listAssigned(auditor);
    expect(list[0]?.noCheck).toBe(false);
    expect(list[0]?.total).toBe(3);
  });

  it('noCheck и понятное сообщение, если чек-лист не выбран', async () => {
    await seedPlan([{ id: 'p1', who: 'Сидорова В. В.', object: 'Кабинет №1' }]);
    const list = await svc.listAssigned(auditor);
    expect(list[0]?.noCheck).toBe(true);
    expect(list[0]?.noCheckNote).toMatch(/не выбран/);
  });

  it('noCheck и понятное сообщение, если выбранного чек-листа нет в каталоге', async () => {
    await seedPlan([{ id: 'p1', check: 'Чек-лист аудита реанимации', who: 'Сидорова В. В.' }]);
    const list = await svc.listAssigned(auditor);
    expect(list[0]?.noCheck).toBe(true);
    expect(list[0]?.noCheckNote).toMatch(/реанимации.*нет в каталоге/);
  });

  it('нельзя отвечать за проверку, где не назначен', async () => {
    await seedPlan([{ id: 'p1', check: 'Чек-лист аудита процедурного кабинета', who: 'Петрова В. В.' }]);
    const r = await svc.answerItem(auditor, 'p1', { index: 0, answer: 'ok' }, 'op-1');
    expect(r.ok).toBe(false);
  });

  it('нельзя отвечать, если у роли нет права walk:run (наблюдатель)', async () => {
    const observer = makeAccount('observer', 'Смирнов А. П.');
    await seedPlan([{ id: 'p1', check: 'Чек-лист аудита процедурного кабинета', who: 'Смирнов А. П.' }]);
    await expect(svc.answerItem(observer, 'p1', { index: 0, answer: 'ok' }, 'op-1')).rejects.toThrow();
  });

  it('записывает ответ и пересчитывает answered/bad/pct', async () => {
    await seedPlan([{ id: 'p1', check: 'Чек-лист аудита процедурного кабинета', who: 'Сидорова В. В.' }]);
    const r1 = await svc.answerItem(auditor, 'p1', { index: 0, answer: 'ok' }, 'op-1');
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.detail.answered).toBe(1);
      expect(r1.detail.bad).toBe(0);
      expect(r1.detail.pct).toBe(33);
    }
    const r2 = await svc.answerItem(auditor, 'p1', { index: 1, answer: 'bad', comment: 'Термометр неисправен' }, 'op-2');
    expect(r2.ok && r2.detail.bad).toBe(1);
    expect(r2.ok && r2.detail.answered).toBe(2);
  });

  it('фото сохраняется через FileStorage и привязывается к пункту', async () => {
    await seedPlan([{ id: 'p1', check: 'Чек-лист аудита процедурного кабинета', who: 'Сидорова В. В.' }]);
    const tinyPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const r = await svc.answerItem(auditor, 'p1', { index: 0, answer: 'bad', photoBase64: tinyPngBase64 }, 'op-1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = r.detail.items[0];
    expect(item?.hasPhoto).toBe(true);
    const stored = await repos.files.read(inn, item!.photoFileId!);
    expect(stored?.contentType).toBe('image/png');
  });

  it('повторный запрос с тем же opId не дублирует применение (идемпотентность)', async () => {
    await seedPlan([{ id: 'p1', check: 'Чек-лист аудита процедурного кабинета', who: 'Сидорова В. В.' }]);
    await svc.answerItem(auditor, 'p1', { index: 0, answer: 'ok' }, 'op-1');
    const retry = await svc.answerItem(auditor, 'p1', { index: 0, answer: 'ok' }, 'op-1');
    expect(retry.ok).toBe(true);
    const list = await svc.listAssigned(auditor);
    expect(list[0]?.answered).toBe(1); // не 2
  });

  it('finish требует, чтобы все пункты были отмечены', async () => {
    await seedPlan([{ id: 'p1', check: 'Чек-лист аудита процедурного кабинета', who: 'Сидорова В. В.' }]);
    await svc.answerItem(auditor, 'p1', { index: 0, answer: 'ok' }, 'op-1');
    const r = await svc.finish(auditor, 'p1', 'op-finish');
    expect(r.ok).toBe(false);
  });

  it('finish завершает проверку и возвращает итоговый счёт нарушений', async () => {
    await seedPlan([{ id: 'p1', check: 'Чек-лист аудита процедурного кабинета', who: 'Сидорова В. В.' }]);
    await svc.answerItem(auditor, 'p1', { index: 0, answer: 'ok' }, 'op-1');
    await svc.answerItem(auditor, 'p1', { index: 1, answer: 'bad' }, 'op-2');
    await svc.answerItem(auditor, 'p1', { index: 2, answer: 'ok' }, 'op-3');
    const r = await svc.finish(auditor, 'p1', 'op-finish');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bad).toBe(1);
      expect(r.total).toBe(3);
    }
    const list = await svc.listAssigned(auditor);
    expect(list[0]?.finished).toBe(true);
    expect(list[0]?.status).toBe('закрыта · 1 нар.');
  });

  it('другой исполнитель не видит и не может завершить чужую проверку', async () => {
    await seedPlan([{ id: 'p1', check: 'Чек-лист аудита процедурного кабинета', who: 'Сидорова В. В.' }]);
    const r = await svc.finish(other, 'p1', 'op-1');
    expect(r.ok).toBe(false);
  });

  it('тенант-изоляция: проверка другой клиники не попадает в список', async () => {
    await seedPlan([{ id: 'p1', check: 'Чек-лист аудита процедурного кабинета', who: 'Сидорова В. В.' }]);
    const otherClinicAuditor = { ...auditor, inn: '5001007322' };
    const list = await svc.listAssigned(otherClinicAuditor);
    expect(list).toEqual([]);
  });
});
