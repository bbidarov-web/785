import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { EquipmentService } from './equipmentService.js';
import type { Account } from '../domain/types.js';
import type { EquipmentType } from '../shared/channelShapes.js';

const inn = '7712345671';

function makeAccount(role: Account['role'], fio: string): Account {
  return {
    id: 'acc_' + role, inn, login: role, phone: null, email: null, org: null,
    fio, side: 'clinic', role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

const TYPES: EquipmentType[] = [
  { key: 'fridge', name: 'Холодильник фармацевтический', logs: [{ name: 'Журнал термометрии', freq: 'ежедневно', kind: 'журнал' }] },
];

describe('EquipmentService — оборудование и журналы', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: EquipmentService;
  const admin = makeAccount('clinic_admin', 'Смирнов А. П.');
  const nurse = makeAccount('nurse', 'Петрова В. В.');
  const otherNurse = makeAccount('nurse', 'Сидорова В. В.');
  const auditor = makeAccount('auditor', 'Козлов Д. Н.');

  beforeEach(async () => {
    repos = createMemoryRepos();
    svc = new EquipmentService(repos);
    await repos.channels.set('platform', null, 'equip_types', TYPES, { updatedBy: null });
  });

  it('clinic_admin заводит позицию оборудования (doc:write)', async () => {
    const r = await svc.upsertPosition(admin, { name: 'Холодильник №1', room: 'Процедурный кабинет', type: 'fridge', logWho: { 'Журнал термометрии': 'Петрова В. В.' } });
    expect(r.ok).toBe(true);
    const list = await svc.listPositions(admin);
    expect(list).toHaveLength(1);
  });

  it('исполнитель не может заводить позиции (нет doc:write)', async () => {
    await expect(svc.upsertPosition(nurse, { name: 'X' })).rejects.toThrow();
  });

  it('исполнитель видит в списке форм только назначенные ему лично', async () => {
    await svc.upsertPosition(admin, { name: 'Холодильник №1', type: 'fridge', logWho: { 'Журнал термометрии': 'Петрова В. В.' } });
    const forms = await svc.listForms(nurse);
    expect(forms).toHaveLength(1);
    const otherForms = await svc.listForms(otherNurse);
    expect(otherForms).toHaveLength(0);
  });

  it('clinic_admin видит все формы независимо от назначения (doc:write)', async () => {
    await svc.upsertPosition(admin, { name: 'Холодильник №1', type: 'fridge', logWho: { 'Журнал термометрии': 'Петрова В. В.' } });
    const forms = await svc.listForms(admin);
    expect(forms).toHaveLength(1);
  });

  it('форма без единой записи считается требующей заполнения', async () => {
    await svc.upsertPosition(admin, { name: 'Холодильник №1', type: 'fridge', logWho: { 'Журнал термометрии': 'Петрова В. В.' } });
    const forms = await svc.listForms(nurse);
    expect(forms[0]?.dueNow).toBe(true);
  });

  it('после заполнения ежедневная форма сегодня не требует повторного заполнения', async () => {
    const pos = await svc.upsertPosition(admin, { name: 'Холодильник №1', type: 'fridge', logWho: { 'Журнал термометрии': 'Петрова В. В.' } });
    if (!pos.ok) throw new Error('setup');
    await svc.fillForm(nurse, pos.position.uid, 'Журнал термометрии', { value: '+4°C' }, 'обход');
    const forms = await svc.listForms(nurse);
    expect(forms[0]?.dueNow).toBe(false);
    expect(forms[0]?.lastFill?.value).toBe('+4°C');
  });

  it('исполнитель не может заполнить форму, назначенную не ему', async () => {
    const pos = await svc.upsertPosition(admin, { name: 'Холодильник №1', type: 'fridge', logWho: { 'Журнал термометрии': 'Петрова В. В.' } });
    if (!pos.ok) throw new Error('setup');
    await expect(svc.fillForm(otherNurse, pos.position.uid, 'Журнал термометрии', {}, 'обход')).rejects.toThrow();
  });

  it('аудитор не может заполнять журналы оборудования (нет journal:write)', async () => {
    const pos = await svc.upsertPosition(admin, { name: 'Холодильник №1', type: 'fridge', logWho: { 'Журнал термометрии': 'Козлов Д. Н.' } });
    if (!pos.ok) throw new Error('setup');
    await expect(svc.fillForm(auditor, pos.position.uid, 'Журнал термометрии', {}, 'обход')).rejects.toThrow();
  });

  it('clinic_admin может заполнить форму за любого назначенного', async () => {
    const pos = await svc.upsertPosition(admin, { name: 'Холодильник №1', type: 'fridge', logWho: { 'Журнал термометрии': 'Петрова В. В.' } });
    if (!pos.ok) throw new Error('setup');
    const r = await svc.fillForm(admin, pos.position.uid, 'Журнал термометрии', { note: 'проверено' }, 'кабинет клиники');
    expect(r.ok).toBe(true);
  });

  it('removePosition удаляет позицию, форма пропадает из списка', async () => {
    const pos = await svc.upsertPosition(admin, { name: 'Холодильник №1', type: 'fridge', logWho: { 'Журнал термометрии': 'Петрова В. В.' } });
    if (!pos.ok) throw new Error('setup');
    await svc.removePosition(admin, pos.position.uid);
    expect(await svc.listPositions(admin)).toEqual([]);
  });

  it('тенант-изоляция: позиции одной клиники не видны в другой', async () => {
    await svc.upsertPosition(admin, { name: 'Холодильник №1', type: 'fridge' });
    const otherAdmin = { ...admin, inn: '5001007322' };
    expect(await svc.listPositions(otherAdmin)).toEqual([]);
  });
});
