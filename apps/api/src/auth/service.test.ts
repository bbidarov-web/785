import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { AuthService } from './service.js';
import { OTP_TTL_MS } from '@kontur785/shared';

describe('AuthService', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let auth: AuthService;

  beforeEach(() => {
    repos = createMemoryRepos();
    auth = new AuthService(repos);
  });

  it('регистрирует клинику и сразу пускает (side=clinic не pending)', async () => {
    const r = await auth.register({
      inn: '7712345671', login: 'medplus', password: 'medplus2026', password2: 'medplus2026',
      org: 'ООО «Медицина Плюс»', fio: 'Смирнов А. П.', side: 'clinic',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pending).toBe(false);
    expect(r.account.role).toBe('clinic_admin');
  });

  it('регистрация сотрудника платформы уходит в заявку (pending) и не пускает сразу', async () => {
    const r = await auth.register({
      inn: '7726345678', login: 'newmethodist', password: 'metodist2026', password2: 'metodist2026',
      fio: 'Иванов И.И.', side: 'operator', role: 'methodist',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pending).toBe(true);
    const login = await auth.login('7726345678', 'newmethodist', 'metodist2026', {});
    expect(login.ok).toBe(false);
  });

  it('отклоняет регистрацию с несовпадающими паролями', async () => {
    const r = await auth.register({ inn: '7712345671', login: 'x', password: 'aaaaaaaa1', password2: 'bbbbbbbb1', fio: 'x', side: 'clinic' });
    expect(r.ok).toBe(false);
  });

  it('предупреждает о неверной контрольной сумме ИНН, но не блокирует регистрацию', async () => {
    // 10 цифр, длина верна, но контрольная сумма не сходится
    const r = await auth.register({ inn: '7712345670', login: 'typo', password: 'aaaaaaaa1', password2: 'aaaaaaaa1', fio: 'x', side: 'clinic' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warn).not.toBe('');
  });

  it('логин с неверным паролем не различает "нет логина" и "неверный пароль"', async () => {
    await auth.register({ inn: '7712345671', login: 'medplus', password: 'medplus2026', password2: 'medplus2026', fio: 'x', side: 'clinic' });
    const badPass = await auth.login('7712345671', 'medplus', 'wrongpass1', {});
    const noLogin = await auth.login('7712345671', 'ghost', 'wrongpass1', {});
    expect(badPass.ok).toBe(false);
    expect(noLogin.ok).toBe(false);
    if (!badPass.ok && !noLogin.ok) expect(badPass.error).toBe(noLogin.error);
  });

  it('успешный логин без 2FA открывает сессию', async () => {
    await auth.register({ inn: '7712345671', login: 'medplus', password: 'medplus2026', password2: 'medplus2026', fio: 'x', side: 'clinic' });
    const r = await auth.login('7712345671', 'medplus', 'medplus2026', {});
    expect(r.ok).toBe(true);
    if (r.ok && 'session' in r) expect(r.session.accountId).toBeTruthy();
  });

  it('2FA: код не возвращается в ответе, верный код открывает сессию', async () => {
    const reg = await auth.register({ inn: '7712345671', login: 'medplus', password: 'medplus2026', password2: 'medplus2026', fio: 'x', side: 'clinic' });
    if (!reg.ok) throw new Error('setup failed');
    await repos.accounts.update(reg.account.id, { twoFactor: true, twoFactorVia: 'sms', phone: '+70000000000' });

    const r = await auth.login('7712345671', 'medplus', 'medplus2026', {});
    expect(r.ok).toBe(true);
    if (!r.ok || !('needOtp' in r)) throw new Error('expected needOtp');
    expect(JSON.stringify(r)).not.toMatch(/\d{6}/); // код не в ответе

    const sentCode = repos.notifier.sentOtp.at(-1)?.code;
    expect(sentCode).toMatch(/^\d{6}$/);

    const wrong = await auth.verifyOtp(reg.account.id, '000000', {});
    expect(wrong.ok).toBe(false);

    const ok = await auth.verifyOtp(reg.account.id, sentCode!, {});
    expect(ok.ok).toBe(true);
  });

  it('2FA: просроченный код отклоняется', async () => {
    const reg = await auth.register({ inn: '7712345671', login: 'medplus', password: 'medplus2026', password2: 'medplus2026', fio: 'x', side: 'clinic' });
    if (!reg.ok) throw new Error('setup failed');
    await repos.accounts.update(reg.account.id, { twoFactor: true });
    await auth.login('7712345671', 'medplus', 'medplus2026', {});
    const sentCode = repos.notifier.sentOtp.at(-1)?.code!;
    repos.clock.advanceMs(OTP_TTL_MS + 1000);
    const r = await auth.verifyOtp(reg.account.id, sentCode, {});
    expect(r.ok).toBe(false);
  });

  it('вход по телефону работает только для роли nurse', async () => {
    const reg = await auth.register({ inn: '7712345671', login: 'ivanova', password: 'vkk2026lead', password2: 'vkk2026lead', fio: 'Иванова М. А.', side: 'clinic', role: 'vkk_lead' });
    if (!reg.ok) throw new Error('setup');
    await repos.accounts.update(reg.account.id, { phone: '+79160000002' });
    const r = await auth.loginByPhone('7712345671', '+79160000002', 'vkk2026lead', {});
    expect(r.ok).toBe(false);
  });

  it('сброс пароля: код не возвращается, верный код меняет пароль', async () => {
    const reg = await auth.register({ inn: '7712345671', login: 'medplus', password: 'medplus2026', password2: 'medplus2026', fio: 'x', side: 'clinic' });
    if (!reg.ok) throw new Error('setup');
    const req = await auth.requestReset('7712345671', 'medplus');
    expect(JSON.stringify(req)).not.toMatch(/\d{6}/);
    const code = repos.notifier.sentReset.at(-1)?.code!;
    const confirm = await auth.confirmReset(reg.account.id, code, 'newpass123', 'newpass123');
    expect(confirm.ok).toBe(true);
    const login = await auth.login('7712345671', 'medplus', 'newpass123', {});
    expect(login.ok).toBe(true);
  });

  it('requestReset отвечает одинаково для существующего и несуществующего логина', async () => {
    const a = await auth.requestReset('7712345671', 'ghost');
    const b = await auth.requestReset('7712345671', 'also-ghost');
    expect(a).toEqual(b);
  });

  it('changePassword требует верный старый пароль и запрещает совпадение с новым', async () => {
    const reg = await auth.register({ inn: '7712345671', login: 'medplus', password: 'medplus2026', password2: 'medplus2026', fio: 'x', side: 'clinic' });
    if (!reg.ok) throw new Error('setup');
    const bad = await auth.changePassword(reg.account.id, 'wrong', 'newpass123', 'newpass123');
    expect(bad.ok).toBe(false);
    const same = await auth.changePassword(reg.account.id, 'medplus2026', 'medplus2026', 'medplus2026');
    expect(same.ok).toBe(false);
    const ok = await auth.changePassword(reg.account.id, 'medplus2026', 'newpass123', 'newpass123');
    expect(ok.ok).toBe(true);
  });

  it('logout отзывает сессию — getSessionContext перестаёт её находить', async () => {
    const reg = await auth.register({ inn: '7712345671', login: 'medplus', password: 'medplus2026', password2: 'medplus2026', fio: 'x', side: 'clinic' });
    if (!reg.ok) throw new Error('setup');
    const login = await auth.login('7712345671', 'medplus', 'medplus2026', {});
    if (!login.ok || !('session' in login)) throw new Error('expected session');
    const before = await auth.getSessionContext(login.session.id);
    expect(before).not.toBeNull();
    await auth.logout(login.session.id);
    const after = await auth.getSessionContext(login.session.id);
    expect(after).toBeNull();
  });
});
