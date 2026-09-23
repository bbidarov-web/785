import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { CapaService } from './capaService.js';
import type { Account } from '../domain/types.js';
import type { WalkResultEntry } from '../shared/channelShapes.js';

const inn = '7712345671';

function makeAccount(role: Account['role'], fio: string): Account {
  return {
    id: 'acc_' + role, inn, login: role, phone: null, email: null, org: null,
    fio, side: 'clinic', role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

const FINISHED_RESULT: WalkResultEntry = {
  planId: 'p1', walkId: 'p1', name: 'Чек-лист аудита стерилизационной', object: 'Стерилизационная', kind: 'плановая',
  who: 'Сидорова В. В.', finished: true, answered: 2, total: 2, bad: 1, date: '01.03.2026', source: 'мобильный обход',
  items: [
    { text: 'Режимы соблюдаются?', answer: 'ok', comment: '', photoFileId: null },
    { text: 'Индикаторы вклеены?', answer: 'bad', comment: 'Индикаторы не вклеены за неделю', photoFileId: null },
  ],
};

describe('CapaService — нарушения и корректирующие мероприятия', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: CapaService;
  const vkk = makeAccount('vkk_lead', 'Иванова М. А.');
  const auditor = makeAccount('auditor', 'Сидорова В. В.');
  const nurse = makeAccount('nurse', 'Петрова В. В.');

  beforeEach(async () => {
    repos = createMemoryRepos();
    svc = new CapaService(repos);
    await repos.channels.set('tenant', inn, 'walk_results', { p1: FINISHED_RESULT }, { updatedBy: null });
  });

  it('listOpenFindings показывает нарушение, не превращённое в мероприятие', async () => {
    const findings = await svc.listOpenFindings(vkk);
    expect(findings).toEqual([{ planId: 'p1', itemIndex: 1, auditName: FINISHED_RESULT.name, object: FINISHED_RESULT.object, text: 'Индикаторы вклеены?', comment: 'Индикаторы не вклеены за неделю' }]);
  });

  it('аудитор фиксирует нарушение обходом, но не заводит мероприятие сам (нет capa:write)', async () => {
    await expect(svc.createFromFinding(auditor, 'p1', 1, {})).rejects.toThrow();
  });

  it('vkk_lead заводит мероприятие по нарушению — оно пропадает из открытых находок', async () => {
    const r = await svc.createFromFinding(vkk, 'p1', 1, { due: '15.03.2026', who: 'Петрова В. В.' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.item.status).toBe('planned');
      expect(r.item.findingText).toBe('Индикаторы вклеены?');
      expect(r.item.who).toBe('Петрова В. В.');
    }
    expect(await svc.listOpenFindings(vkk)).toEqual([]);
  });

  it('нельзя завести мероприятие дважды по одному и тому же нарушению', async () => {
    await svc.createFromFinding(vkk, 'p1', 1, {});
    const second = await svc.createFromFinding(vkk, 'p1', 1, {});
    expect(second.ok).toBe(false);
  });

  it('нельзя завести мероприятие по пункту без нарушения (answer=ok)', async () => {
    const r = await svc.createFromFinding(vkk, 'p1', 0, {});
    expect(r.ok).toBe(false);
  });

  it('без указания ответственного мероприятие наследует "who" самой проверки', async () => {
    const r = await svc.createFromFinding(vkk, 'p1', 1, {});
    expect(r.ok && r.item.who).toBe('Сидорова В. В.');
  });

  it('исполнитель отмечает выполненным СВОЁ мероприятие (capa:own)', async () => {
    const created = await svc.createFromFinding(vkk, 'p1', 1, { who: 'Петрова В. В.' });
    if (!created.ok) throw new Error('setup');
    const r = await svc.updateStatus(nurse, created.item.id, 'done');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.item.status).toBe('done');
  });

  it('исполнитель не может отметить выполненным чужое мероприятие', async () => {
    const created = await svc.createFromFinding(vkk, 'p1', 1, { who: 'Другой Человек' });
    if (!created.ok) throw new Error('setup');
    await expect(svc.updateStatus(nurse, created.item.id, 'done')).rejects.toThrow();
  });

  it('исполнитель не может вернуть своё выполненное мероприятие обратно в "запланировано"', async () => {
    const created = await svc.createFromFinding(vkk, 'p1', 1, { who: 'Петрова В. В.' });
    if (!created.ok) throw new Error('setup');
    await svc.updateStatus(nurse, created.item.id, 'done');
    await expect(svc.updateStatus(nurse, created.item.id, 'planned')).rejects.toThrow();
  });

  it('vkk_lead может вернуть мероприятие в "запланировано" (capa:write без ограничений)', async () => {
    const created = await svc.createFromFinding(vkk, 'p1', 1, { who: 'Петрова В. В.' });
    if (!created.ok) throw new Error('setup');
    await svc.updateStatus(nurse, created.item.id, 'done');
    const r = await svc.updateStatus(vkk, created.item.id, 'planned');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.item.closedAt).toBeNull();
  });

  it('observer видит реестр (journal:read), но не может создавать мероприятия', async () => {
    const observer = makeAccount('observer', 'Смирнов А. П.');
    await svc.createFromFinding(vkk, 'p1', 1, {});
    const list = await svc.list(observer);
    expect(list).toHaveLength(1);
    await expect(svc.createFromFinding(observer, 'p1', 1, {})).rejects.toThrow();
  });

  it('тенант-изоляция: находки другой клиники не видны', async () => {
    const otherVkk = { ...vkk, inn: '5001007322' };
    expect(await svc.listOpenFindings(otherVkk)).toEqual([]);
  });
});
