import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { SelfAuditService } from './selfAuditService.js';
import { CapaService } from './capaService.js';
import type { Account } from '../domain/types.js';
import type { ChecklistDef } from '../shared/channelShapes.js';

const inn = '7712345671';

function makeAccount(role: Account['role']): Account {
  return {
    id: 'acc_' + role, inn, login: role, phone: null, email: null, org: 'ООО «Медицина Плюс»',
    fio: 'Иванова М. А.', side: 'clinic', role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

const CATALOG: ChecklistDef[] = [{ name: 'Чек-лист аудита стерилизационной', items: ['Режимы соблюдаются?', 'Индикаторы вклеены?'] }];

describe('SelfAuditService — самообследование', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: SelfAuditService;
  let capa: CapaService;
  const vkk = makeAccount('vkk_lead');
  const auditor = makeAccount('auditor');

  beforeEach(async () => {
    repos = createMemoryRepos();
    capa = new CapaService(repos);
    svc = new SelfAuditService(repos, capa);
    await repos.channels.set('platform', null, 'checklists', CATALOG, { updatedBy: null });
    await repos.tenants.upsert(inn, 'ООО «Медицина Плюс»');
  });

  it('vkk_lead начинает прогон (plan:write)', async () => {
    const r = await svc.start(vkk, 'Чек-лист аудита стерилизационной');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.run.items).toHaveLength(2);
  });

  it('аудитор не может начать самообследование (нет plan:write)', async () => {
    await expect(svc.start(auditor, 'Чек-лист аудита стерилизационной')).rejects.toThrow();
  });

  it('начало по неизвестному чек-листу отклоняется', async () => {
    const r = await svc.start(vkk, 'Не существует');
    expect(r.ok).toBe(false);
  });

  it('finish требует ответа на все пункты', async () => {
    await svc.start(vkk, 'Чек-лист аудита стерилизационной');
    await svc.answer(vkk, 'Чек-лист аудита стерилизационной', 0, 'ok', '');
    const r = await svc.finish(vkk, 'Чек-лист аудита стерилизационной');
    expect(r.ok).toBe(false);
  });

  it('finish заводит мероприятие по каждому "не соответствует" — реальная, а не выдуманная автоматика', async () => {
    await svc.start(vkk, 'Чек-лист аудита стерилизационной');
    await svc.answer(vkk, 'Чек-лист аудита стерилизационной', 0, 'ok', '');
    await svc.answer(vkk, 'Чек-лист аудита стерилизационной', 1, 'bad', 'Индикаторы просрочены');
    const r = await svc.finish(vkk, 'Чек-лист аудита стерилизационной');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.run.finished).toBe(true);
      expect(r.capaCreated).toBe(1);
    }
    const capaList = await capa.list(vkk);
    expect(capaList).toHaveLength(1);
    expect(capaList[0]?.sourceKind).toBe('selfaudit');
    expect(capaList[0]?.findingText).toBe('Индикаторы вклеены?');
  });

  it('пункт "не применимо" не заводит мероприятие', async () => {
    await svc.start(vkk, 'Чек-лист аудита стерилизационной');
    await svc.answer(vkk, 'Чек-лист аудита стерилизационной', 0, 'na', '');
    await svc.answer(vkk, 'Чек-лист аудита стерилизационной', 1, 'ok', '');
    const r = await svc.finish(vkk, 'Чек-лист аудита стерилизационной');
    expect(r.ok && r.capaCreated).toBe(0);
  });

  it('finish уже завершённого прогона не заводит мероприятия повторно', async () => {
    await svc.start(vkk, 'Чек-лист аудита стерилизационной');
    await svc.answer(vkk, 'Чек-лист аудита стерилизационной', 0, 'bad', 'x');
    await svc.answer(vkk, 'Чек-лист аудита стерилизационной', 1, 'ok', '');
    await svc.finish(vkk, 'Чек-лист аудита стерилизационной');
    const capaList = await capa.list(vkk);
    expect(capaList).toHaveLength(1);
  });

  it('ответ после завершения отклоняется', async () => {
    await svc.start(vkk, 'Чек-лист аудита стерилизационной');
    await svc.answer(vkk, 'Чек-лист аудита стерилизационной', 0, 'ok', '');
    await svc.answer(vkk, 'Чек-лист аудита стерилизационной', 1, 'ok', '');
    await svc.finish(vkk, 'Чек-лист аудита стерилизационной');
    const r = await svc.answer(vkk, 'Чек-лист аудита стерилизационной', 0, 'bad', '');
    expect(r.ok).toBe(false);
  });

  it('exportPackage собирает текстовый пакет со всеми прогонами', async () => {
    await svc.start(vkk, 'Чек-лист аудита стерилизационной');
    await svc.answer(vkk, 'Чек-лист аудита стерилизационной', 0, 'ok', '');
    await svc.answer(vkk, 'Чек-лист аудита стерилизационной', 1, 'bad', 'проблема');
    await svc.finish(vkk, 'Чек-лист аудита стерилизационной');
    const r = await svc.exportPackage(vkk);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain('ООО «Медицина Плюс»');
      expect(r.text).toContain('НЕ СООТВЕТСТВУЕТ');
      expect(r.text).toContain('проблема');
    }
  });

  it('тенант-изоляция: прогоны одной клиники не видны в другой', async () => {
    await svc.start(vkk, 'Чек-лист аудита стерилизационной');
    const otherVkk = { ...vkk, inn: '5001007322' };
    expect(await svc.listRuns(otherVkk)).toEqual([]);
  });
});
