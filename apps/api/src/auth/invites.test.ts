import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { AuthService } from './service.js';
import type { Account } from '../domain/types.js';

const INN = '7712345671';
const OTHER = '5001007322';

describe('Приглашения сотрудников по ссылке', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let auth: AuthService;
  let admin: Account;

  const reg = (inn: string, login: string, extra: Record<string, unknown> = {}) =>
    auth.register({ inn, login, password: 'Passw0rd2026', password2: 'Passw0rd2026', fio: login, side: 'clinic', ...extra });

  beforeEach(async () => {
    repos = createMemoryRepos();
    auth = new AuthService(repos);
    const r = await reg(INN, 'clinicadmin', { org: 'ООО «Медицина Плюс»' });
    if (!r.ok) throw new Error('setup');
    admin = r.account;
  });

  it('приглашённый регистрируется сразу активным, с ролью и филиалом из приглашения', async () => {
    const inv = await auth.invites.create(admin, 'nurse', 'Филиал Север');
    if (!inv.ok) throw new Error('invite');
    const r = await reg(INN, 'newnurse', { invite: inv.token });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pending).toBe(false);
    expect(r.account.role).toBe('nurse');
    expect(r.account.branchName).toBe('Филиал Север');
    expect(r.account.approvedById).toBe(admin.id);
    const login = await auth.login(INN, 'newnurse', 'Passw0rd2026', {});
    expect(login.ok).toBe(true);
  });

  it('роль из формы игнорируется: приглашение на медсестру не даёт clinic_admin', async () => {
    const inv = await auth.invites.create(admin, 'nurse', null);
    if (!inv.ok) throw new Error('invite');
    const r = await reg(INN, 'sneaky', { invite: inv.token, role: 'clinic_admin' });
    expect(r.ok && r.account.role).toBe('nurse');
  });

  it('ссылка одноразовая: второй человек с тем же токеном отклоняется', async () => {
    const inv = await auth.invites.create(admin, 'vkk_lead', null);
    if (!inv.ok) throw new Error('invite');
    expect((await reg(INN, 'first', { invite: inv.token })).ok).toBe(true);
    const second = await reg(INN, 'second', { invite: inv.token });
    expect(second.ok).toBe(false);
    expect(await repos.accounts.findByInnLogin(INN, 'second')).toBeNull();
  });

  it('опечатка в логине не сжигает приглашение', async () => {
    const inv = await auth.invites.create(admin, 'nurse', null);
    if (!inv.ok) throw new Error('invite');
    expect((await reg(INN, 'ab', { invite: inv.token })).ok).toBe(false); // логин короче трёх
    expect((await reg(INN, 'abc', { invite: inv.token })).ok).toBe(true);
  });

  it('просроченное приглашение недействительно', async () => {
    const inv = await auth.invites.create(admin, 'nurse', null);
    if (!inv.ok) throw new Error('invite');
    repos.clock.advanceMs(8 * 24 * 3600 * 1000);
    expect(await auth.invites.peek(inv.token)).toBeNull();
    expect((await reg(INN, 'late', { invite: inv.token })).ok).toBe(false);
  });

  it('отозванное приглашение недействительно и исчезает из списка', async () => {
    const inv = await auth.invites.create(admin, 'nurse', null);
    if (!inv.ok) throw new Error('invite');
    expect(await auth.invites.list(admin)).toHaveLength(1);
    expect((await auth.invites.revoke(admin, inv.invite.id)).ok).toBe(true);
    expect(await auth.invites.list(admin)).toHaveLength(0);
    expect((await reg(INN, 'revoked', { invite: inv.token })).ok).toBe(false);
  });

  it('КРИТИЧНО: токен одной клиники не работает на ИНН другой', async () => {
    const other = await reg(OTHER, 'adminb');
    if (!other.ok) throw new Error('setup');
    const inv = await auth.invites.create(admin, 'nurse', null);
    if (!inv.ok) throw new Error('invite');
    const secret = inv.token.split('.')[1];
    expect((await reg(OTHER, 'intruder', { invite: inv.token })).ok).toBe(false); // ИНН токена ≠ ИНН формы
    expect((await reg(OTHER, 'intruder2', { invite: `${OTHER}.${secret}` })).ok).toBe(false); // подмена ИНН в токене
    expect(await auth.invites.peek(`${OTHER}.${secret}`)).toBeNull();
  });

  it('создавать, смотреть и отзывать приглашения может только администратор клиники', async () => {
    const nurse = await reg(INN, 'plainnurse', { role: 'nurse' });
    if (!nurse.ok) throw new Error('setup');
    await repos.accounts.update(nurse.account.id, { pending: false });
    await expect(auth.invites.create(nurse.account, 'nurse', null)).rejects.toThrow();
    await expect(auth.invites.list(nurse.account)).rejects.toThrow();
  });

  it('в хранилище лежит хеш секрета, а не сам токен', async () => {
    const inv = await auth.invites.create(admin, 'nurse', null);
    if (!inv.ok) throw new Error('invite');
    const stored = JSON.stringify((await repos.channels.get('tenant', INN, 'invites', [])).data);
    expect(stored).not.toContain(inv.token.split('.')[1]!);
  });

  it('публичная проверка отдаёт клинику и роль, но не служебные поля', async () => {
    const inv = await auth.invites.create(admin, 'auditor', 'Центр');
    if (!inv.ok) throw new Error('invite');
    expect(await auth.invites.peek(inv.token)).toEqual({ inn: INN, org: 'ООО «Медицина Плюс»', role: 'auditor', branchName: 'Центр' });
    expect(await auth.invites.peek('мусор')).toBeNull();
    expect(await auth.invites.peek(`${INN}.wrong`)).toBeNull();
  });
});
