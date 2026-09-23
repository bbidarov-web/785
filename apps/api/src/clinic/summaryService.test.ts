import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { SummaryService } from './summaryService.js';
import type { Account } from '../domain/types.js';
import type { SummaryRowDef } from '../shared/channelShapes.js';

const inn = '7712345671';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function makeAccount(role: Account['role']): Account {
  return {
    id: 'acc_' + role, inn, login: role, phone: null, email: null, org: null,
    fio: 'Смирнов А. П.', side: 'clinic', role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

const MASTER: SummaryRowDef[] = [{ name: 'Сводный отчёт по системе качества за год', note: 'итоги проверок', req: true }];

describe('SummaryService — сводный отчёт', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: SummaryService;
  const admin = makeAccount('clinic_admin');
  const nurse = makeAccount('nurse');

  beforeEach(async () => {
    repos = createMemoryRepos();
    svc = new SummaryService(repos);
    await repos.channels.set('platform', null, 'summary_master', MASTER, { updatedBy: null });
  });

  it('до загрузки строка отчёта показывает отсутствие файла', async () => {
    const view = await svc.getView(admin);
    expect(view[0]?.file).toBeNull();
    expect(view[0]?.required).toBe(true);
  });

  it('clinic_admin загружает файл (doc:write)', async () => {
    const r = await svc.uploadFile(admin, 'Сводный отчёт по системе качества за год', 'отчёт.png', PNG);
    expect(r.ok).toBe(true);
    const view = await svc.getView(admin);
    expect(view[0]?.file?.fileName).toBe('отчёт.png');
  });

  it('исполнитель не может загружать файлы (нет doc:write)', async () => {
    await expect(svc.uploadFile(nurse, 'Сводный отчёт по системе качества за год', 'x.png', PNG)).rejects.toThrow();
  });

  it('загрузка по несуществующей строке отклоняется', async () => {
    const r = await svc.uploadFile(admin, 'Не существует', 'x.png', PNG);
    expect(r.ok).toBe(false);
  });

  it('повторная загрузка заменяет предыдущий файл', async () => {
    await svc.uploadFile(admin, 'Сводный отчёт по системе качества за год', 'v1.png', PNG);
    await svc.uploadFile(admin, 'Сводный отчёт по системе качества за год', 'v2.png', PNG);
    const view = await svc.getView(admin);
    expect(view[0]?.file?.fileName).toBe('v2.png');
  });

  it('removeFile убирает загруженный файл', async () => {
    await svc.uploadFile(admin, 'Сводный отчёт по системе качества за год', 'v1.png', PNG);
    const r = await svc.removeFile(admin, 'Сводный отчёт по системе качества за год');
    expect(r.ok).toBe(true);
    const view = await svc.getView(admin);
    expect(view[0]?.file).toBeNull();
  });

  it('тенант-изоляция: файлы одной клиники не видны в другой', async () => {
    await svc.uploadFile(admin, 'Сводный отчёт по системе качества за год', 'v1.png', PNG);
    const otherAdmin = { ...admin, inn: '5001007322' };
    const view = await svc.getView(otherAdmin);
    expect(view[0]?.file).toBeNull();
  });
});
