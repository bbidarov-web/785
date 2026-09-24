import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { ProfileService } from './profileService.js';
import type { Account } from '../domain/types.js';
import type { ClinicProfile } from '../shared/channelShapes.js';

const inn = '7712345671';

function makeAccount(role: Account['role']): Account {
  return {
    id: 'acc_' + role, inn, login: role, phone: null, email: null, org: null,
    fio: 'Смирнов А. П.', side: 'clinic', role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

describe('ProfileService — реквизиты клиники', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: ProfileService;
  const admin = makeAccount('clinic_admin');
  const vkk = makeAccount('vkk_lead');
  const nurse = makeAccount('nurse');

  const profile: ClinicProfile = { orgFull: 'ООО «Медицина Плюс»', orgShort: 'Медицина Плюс', license: 'ЛО-77-01-123456', chiefDoctor: 'Иванов И. И.', city: 'Москва' };

  beforeEach(() => {
    repos = createMemoryRepos();
    svc = new ProfileService(repos);
  });

  it('без сохранения — пустые реквизиты, а не ошибка', async () => {
    expect(await svc.get(admin)).toEqual({ orgFull: '', orgShort: '', license: '', chiefDoctor: '', city: '' });
  });

  it('администратор клиники сохраняет реквизиты (org:write)', async () => {
    const r = await svc.save(admin, profile);
    expect(r.ok).toBe(true);
    expect(await svc.get(admin)).toEqual(profile);
  });

  it('ответственный за ВКК не может изменить реквизиты (нет org:write)', async () => {
    await expect(svc.save(vkk, profile)).rejects.toThrow();
  });

  it('ответственный за ВКК и медсестра могут читать реквизиты (doc:read)', async () => {
    await svc.save(admin, profile);
    expect(await svc.get(vkk)).toEqual(profile);
    expect(await svc.get(nurse)).toEqual(profile);
  });

  it('тенант-изоляция: реквизиты другой клиники не видны', async () => {
    await svc.save(admin, profile);
    const otherAdmin = { ...admin, inn: '5001007322' };
    expect(await svc.get(otherAdmin)).toEqual({ orgFull: '', orgShort: '', license: '', chiefDoctor: '', city: '' });
  });

  it('getForTenant читает реквизиты без проверки прав — для подстановки в шаблоны документов', async () => {
    await svc.save(admin, profile);
    expect(await svc.getForTenant(inn)).toEqual(profile);
  });
});
