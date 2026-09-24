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
  { code: 2, name: 'Организационный пакет', price: 68000, blocks: [] },
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

  async function markPaid(code: number) {
    const rec = await repos.channels.get('tenant', inn, 'stage_paid', {});
    const data = rec.data as Record<number, { status: string }>;
    await repos.channels.set('tenant', inn, 'stage_paid', { ...data, [code]: { ...data[code], status: 'paid' } }, { expectedVersion: rec.version, updatedBy: null });
  }

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
    await markPaid(1);
    const r = await svc.requestPayment(admin, 1);
    expect(r.ok).toBe(false);
  });

  it('документ не отдаётся без выдачи, даже если этап оплачен', async () => {
    await svc.requestPayment(admin, 1);
    await markPaid(1);
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
    await markPaid(1);
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

  describe('последовательная блокировка этапов и приёмка платформой', () => {
    it('первый этап никогда не заблокирован', async () => {
      const view = await svc.getClinicView(admin);
      expect(view[0]?.locked).toBe(false);
    });

    it('второй этап заблокирован, пока первый не оплачен и не принят', async () => {
      const view = await svc.getClinicView(admin);
      expect(view[1]?.locked).toBe(true);
    });

    it('заказать оплату второго этапа нельзя, пока первый не принят платформой', async () => {
      await svc.requestPayment(admin, 1);
      await markPaid(1); // оплачен, но ещё не принят
      const r = await svc.requestPayment(admin, 2);
      expect(r.ok).toBe(false);
    });

    it('vkk_lead и клиника не могут принять этап (нет doc:grant) — принимает только платформа', async () => {
      await svc.requestPayment(admin, 1);
      await markPaid(1);
      await expect(svc.acceptStage(admin, inn, 1)).rejects.toThrow();
      await expect(svc.acceptStage(vkk, inn, 1)).rejects.toThrow();
    });

    it('методист не может принять неоплаченный этап', async () => {
      const r = await svc.acceptStage(methodist, inn, 1);
      expect(r.ok).toBe(false);
    });

    it('методист принимает оплаченный этап — второй этап разблокируется', async () => {
      await svc.requestPayment(admin, 1);
      await markPaid(1);
      const accept = await svc.acceptStage(methodist, inn, 1);
      expect(accept.ok).toBe(true);
      if (accept.ok) expect(accept.payment.accepted).toBe(true);

      const view = await svc.getClinicView(admin);
      expect(view[1]?.locked).toBe(false);

      const r = await svc.requestPayment(admin, 2);
      expect(r.ok).toBe(true);
    });

    it('повторная приёмка уже принятого этапа отклоняется', async () => {
      await svc.requestPayment(admin, 1);
      await markPaid(1);
      await svc.acceptStage(methodist, inn, 1);
      const r = await svc.acceptStage(methodist, inn, 1);
      expect(r.ok).toBe(false);
    });
  });

  describe('оффер этапа — клиника принимает условия до заказа оплаты', () => {
    // оффер — на этапе 2, чтобы проверка гейта не путалась с последовательной блокировкой:
    // для неё этап 1 сначала честно проходит полный цикл оплата → приёмка платформой
    const CATALOG_WITH_OFFER: Stage[] = [
      { code: 1, name: 'Базовая система', price: 68000, blocks: [] },
      { code: 2, name: 'Организационный пакет', price: 68000, offerText: 'Условия оффера этапа 2', offerFile: 'Оффер_этап_2.pdf', blocks: [] },
    ];

    beforeEach(async () => {
      await repos.channels.set('platform', null, 'stage_docs', CATALOG_WITH_OFFER, { updatedBy: null });
      await svc.requestPayment(admin, 1);
      await markPaid(1);
      await svc.acceptStage(methodist, inn, 1); // разблокировать этап 2 — иначе гейт локи и гейт оффера неразличимы
    });

    it('заказать оплату этапа с оффером нельзя, пока условия не приняты', async () => {
      const r = await svc.requestPayment(admin, 2);
      expect(r.ok).toBe(false);
    });

    it('после принятия оффера заказ проходит', async () => {
      const accept = await svc.acceptOffer(admin, 2);
      expect(accept.ok).toBe(true);
      if (accept.ok) expect(accept.payment.offerAccepted).toBe(true);
      const r = await svc.requestPayment(admin, 2);
      expect(r.ok).toBe(true);
    });

    it('vkk_lead не может принять оффер (нет order:write)', async () => {
      await expect(svc.acceptOffer(vkk, 2)).rejects.toThrow();
    });

    it('повторное принятие оффера отклоняется', async () => {
      await svc.acceptOffer(admin, 2);
      const r = await svc.acceptOffer(admin, 2);
      expect(r.ok).toBe(false);
    });

    it('принять оффер у этапа без условий нечего', async () => {
      const r = await svc.acceptOffer(admin, 1);
      expect(r.ok).toBe(false);
    });

    it('каталог отдаёт текст и файл оффера клинике', async () => {
      const view = await svc.getClinicView(admin);
      expect(view[0]).toMatchObject({ offerText: null, offerFile: null });
      expect(view[1]).toMatchObject({ offerText: 'Условия оффера этапа 2', offerFile: 'Оффер_этап_2.pdf' });
    });
  });
});
