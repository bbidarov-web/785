import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { InventoryService } from './inventoryService.js';
import { DocumentService } from '../documents/service.js';
import type { Account } from '../domain/types.js';
import type { Stage, SummaryRowDef } from '../shared/channelShapes.js';

const inn = '7712345671';

function makeAccount(role: Account['role'], side: Account['side'] = 'clinic'): Account {
  return {
    id: 'acc_' + role, inn, login: role, phone: null, email: null, org: null,
    fio: 'Смирнов А. П.', side, role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

const CATALOG: Stage[] = [
  { code: 1, name: 'Базовая система', price: 68000, blocks: [{ key: 'b01', num: '01', name: 'Управление ВКК', docs: [
    { name: 'Приказ о создании комиссии', template: '' },
    { name: 'Положение о ВКК', template: '' },
  ] }] },
];
const SUMMARY_MASTER: SummaryRowDef[] = [{ name: 'Сводный отчёт за год', note: '', req: true }];

describe('InventoryService — опись документов', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: InventoryService;
  let docs: DocumentService;
  const admin = makeAccount('clinic_admin');
  const nurse = makeAccount('nurse');
  const methodist = makeAccount('methodist', 'platform');

  beforeEach(async () => {
    repos = createMemoryRepos();
    svc = new InventoryService(repos);
    docs = new DocumentService(repos);
    await repos.tenants.upsert(inn, 'ООО «Медицина Плюс»');
    await repos.channels.set('platform', null, 'stage_docs', CATALOG, { updatedBy: null });
    await repos.channels.set('platform', null, 'summary_master', SUMMARY_MASTER, { updatedBy: null });
  });

  it('без выдач и загрузок — все строки не заполнены', async () => {
    const { rows, summary } = await svc.getInventory(admin);
    expect(rows).toHaveLength(3); // 2 документа этапа + 1 строка сводного отчёта
    expect(rows.every((r) => !r.filled)).toBe(true);
    expect(summary).toEqual({ total: 3, filled: 0, notFilled: 3 });
  });

  it('исполнитель клиники тоже может читать опись (doc:read)', async () => {
    const { rows } = await svc.getInventory(nurse);
    expect(rows).toHaveLength(3);
  });

  it('выданный документ этапа помечается заполненным с датой', async () => {
    await docs.grant(inn, '1', 'Приказ о создании комиссии', 'Приказ о создании комиссии', methodist, true);
    const { rows, summary } = await svc.getInventory(admin);
    const row = rows.find((r) => r.name === 'Приказ о создании комиссии');
    expect(row).toMatchObject({ filled: true, filledLabel: 'выдан', stageCode: 1 });
    expect(row?.filledAt).toBeTruthy();
    expect(summary.filled).toBe(1);
  });

  it('загруженный файл сводного отчёта помечается заполненным', async () => {
    await repos.channels.set('tenant', inn, 'summary_files', { 'Сводный отчёт за год': { fileId: 'f1', fileName: 'отчёт.pdf', date: '01.01.2026', uploadedBy: admin.id } }, { updatedBy: null });
    const { rows } = await svc.getInventory(admin);
    const row = rows.find((r) => r.name === 'Сводный отчёт за год');
    expect(row).toMatchObject({ filled: true, filledLabel: 'загружен', stageCode: null, required: true });
  });

  it('тенант-изоляция: выдача одной клиники не видна другой', async () => {
    await docs.grant(inn, '1', 'Приказ о создании комиссии', 'Приказ о создании комиссии', methodist, true);
    const otherAdmin = { ...admin, inn: '5001007322' };
    const { summary } = await svc.getInventory(otherAdmin);
    expect(summary.filled).toBe(0);
  });
});
