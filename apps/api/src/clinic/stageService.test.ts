import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { StageService } from './stageService.js';
import { DocumentService } from '../documents/service.js';
import type { Account } from '../domain/types.js';
import type { Stage } from '../shared/channelShapes.js';

const inn = '7712345671';

function makeAccount(role: Account['role'], side: Account['side'] = 'clinic'): Account {
  return {
    id: 'acc_' + role, inn, login: role, phone: null, email: null, org: 'ООО «Медицина Плюс»',
    fio: 'Смирнов А. П.', side, role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

const CATALOG: Stage[] = [
  {
    code: 1, name: 'Базовая система', price: 68000,
    blocks: [{ key: 'b01', num: '01', name: 'Управление ВКК', docs: [
      { name: 'Приказ о создании комиссии по внутреннему контролю', template: 'Приказ\nОрганизация: {{org}}\nИНН: {{inn}}\nДата: {{date}}\nОтветственный: {{responsible}}' },
      { name: 'Положение о порядке проведения ВККиБМД', template: 'Положение о {{org}}' },
    ] }],
  },
];

describe('StageService — этапы внедрения и документы', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: StageService;
  let docs: DocumentService;
  const admin = makeAccount('clinic_admin');
  const vkk = makeAccount('vkk_lead');
  const methodist = makeAccount('methodist', 'platform');

  beforeEach(async () => {
    repos = createMemoryRepos();
    svc = new StageService(repos);
    docs = new DocumentService(repos);
    await repos.tenants.upsert(inn, 'ООО «Медицина Плюс»');
    await repos.channels.set('platform', null, 'stage_docs', CATALOG, { updatedBy: null });
  });

  it('клиника видит каталог с непройденной оплатой и невыданными документами', async () => {
    const view = await svc.getClinicView(admin);
    expect(view[0]?.payment.status).toBe('none');
    expect(view[0]?.blocks[0]?.docs.every((d) => !d.granted)).toBe(true);
  });

  it('clinic_admin запрашивает оплату этапа (order:write)', async () => {
    const r = await svc.requestPayment(admin, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payment.status).toBe('pending');
    const view = await svc.getClinicView(admin);
    expect(view[0]?.payment.status).toBe('pending');
  });

  it('vkk_lead не может заказать оплату этапа (нет order:write)', async () => {
    await expect(svc.requestPayment(vkk, 1)).rejects.toThrow();
  });

  it('повторный запрос оплаты уже оплаченного этапа отклоняется', async () => {
    await svc.requestPayment(admin, 1);
    // подтверждаем оплату напрямую через канал — платёж проверяется отдельным сервисом
    const rec = await repos.channels.get('tenant', inn, 'stage_paid', {});
    const data = rec.data as Record<number, { status: string }>;
    await repos.channels.set('tenant', inn, 'stage_paid', { ...data, 1: { ...data[1], status: 'paid' } }, { expectedVersion: rec.version, updatedBy: null });
    const r = await svc.requestPayment(admin, 1);
    expect(r.ok).toBe(false);
  });

  it('документ не отдаётся без выдачи, даже если этап оплачен', async () => {
    await svc.requestPayment(admin, 1);
    const rec = await repos.channels.get('tenant', inn, 'stage_paid', {});
    const data = rec.data as Record<number, { status: string }>;
    await repos.channels.set('tenant', inn, 'stage_paid', { ...data, 1: { ...data[1], status: 'paid' } }, { expectedVersion: rec.version, updatedBy: null });
    const r = await svc.getDocumentContent(admin, 'Приказ о создании комиссии по внутреннему контролю');
    expect(r.ok).toBe(false);
  });

  it('документ не отдаётся без оплаты этапа, даже если выдан', async () => {
    await docs.grant(inn, '1', 'Приказ о создании комиссии по внутреннему контролю', 'Приказ о создании комиссии по внутреннему контролю', methodist, true);
    const r = await svc.getDocumentContent(admin, 'Приказ о создании комиссии по внутреннему контролю');
    expect(r.ok).toBe(false);
  });

  it('оплаченный и выданный документ отдаётся с подставленными переменными', async () => {
    await svc.requestPayment(admin, 1);
    const rec = await repos.channels.get('tenant', inn, 'stage_paid', {});
    const data = rec.data as Record<number, { status: string }>;
    await repos.channels.set('tenant', inn, 'stage_paid', { ...data, 1: { ...data[1], status: 'paid' } }, { expectedVersion: rec.version, updatedBy: null });
    await docs.grant(inn, '1', 'Приказ о создании комиссии по внутреннему контролю', 'Приказ о создании комиссии по внутреннему контролю', methodist, true);
    await repos.channels.set('tenant', inn, 'docasg', { 'Приказ о создании комиссии по внутреннему контролю': 'Иванова М. А.' }, { updatedBy: null });

    const r = await svc.getDocumentContent(admin, 'Приказ о создании комиссии по внутреннему контролю');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toContain('ООО «Медицина Плюс»');
      expect(r.content).toContain(inn);
      expect(r.content).toContain('Иванова М. А.');
    }
  });

  it('тенант-изоляция: у другой клиники своя оплата и выдачи', async () => {
    await svc.requestPayment(admin, 1);
    const otherAdmin = { ...admin, inn: '5001007322' };
    const view = await svc.getClinicView(otherAdmin);
    expect(view[0]?.payment.status).toBe('none');
  });
});
