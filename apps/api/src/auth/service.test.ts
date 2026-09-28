import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { AuthService } from './service.js';
import { OTP_TTL_MS, normPhone } from '@kontur785/shared';

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

  it('КРИТИЧНО: side=clinic с role=platform_admin отклоняется — саморегистрация не создаёт активного сотрудника платформы', async () => {
    const r = await auth.register({
      inn: '7712345671', login: 'fake_admin', password: 'medplus2026', password2: 'medplus2026',
      fio: 'X', side: 'clinic', role: 'platform_admin',
    });
    expect(r.ok).toBe(false);
    const login = await auth.login('7712345671', 'fake_admin', 'medplus2026', {});
    expect(login.ok).toBe(false); // учётной записи не существует вовсе
  });

  it('side=clinic с любой другой платформенной ролью (methodist/sales_manager/sales_head) тоже отклоняется', async () => {
    for (const role of ['methodist', 'sales_manager', 'sales_head'] as const) {
      const r = await auth.register({
        inn: '7712345671', login: 'x_' + role, password: 'medplus2026', password2: 'medplus2026',
        fio: 'X', side: 'clinic', role,
      });
      expect(r.ok).toBe(false);
    }
  });

  it('side=operator с клинической ролью (vkk_lead и т.п.) отклоняется', async () => {
    const r = await auth.register({
      inn: '7726345678', login: 'confused', password: 'metodist2026', password2: 'metodist2026',
      fio: 'X', side: 'operator', role: 'vkk_lead',
    });
    expect(r.ok).toBe(false);
  });

  it('side=clinic с клинической ролью, отличной от clinic_admin (vkk_lead/nurse/auditor), проходит', async () => {
    const r = await auth.register({
      inn: '7712345671', login: 'vkk1', password: 'vkk2026lead', password2: 'vkk2026lead',
      fio: 'Иванова М. А.', side: 'clinic', role: 'vkk_lead',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.account.role).toBe('vkk_lead');
  });

  it('КРИТИЧНО: саморегистрация НЕЗНАКОМЦА на ИНН уже существующей клиники уходит в заявку, а не пускает сразу', async () => {
    const first = await auth.register({
      inn: '7712345671', login: 'clinicadmin', password: 'admin2026aa', password2: 'admin2026aa',
      fio: 'Смирнов А. П.', side: 'clinic', role: 'clinic_admin',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.pending).toBe(false); // первая регистрация на НОВЫЙ ИНН заводит клинику и пускает сразу

    const stranger = await auth.register({
      inn: '7712345671', login: 'stranger', password: 'stranger2026', password2: 'stranger2026',
      fio: 'Чужой Человек', side: 'clinic', role: 'clinic_admin', // знает только публичный ИНН клиники
    });
    expect(stranger.ok).toBe(true);
    if (!stranger.ok) return;
    expect(stranger.pending).toBe(true); // не активна сама по себе

    const login = await auth.login('7712345671', 'stranger', 'stranger2026', {});
    expect(login.ok).toBe(false);
    if (!login.ok) expect(login.error).toContain('администратора клиники');
  });

  it('администратор клиники подтверждает заявку СВОЕГО сотрудника — тот получает доступ с назначенной ролью', async () => {
    const admin = await auth.register({
      inn: '7712345671', login: 'clinicadmin', password: 'admin2026aa', password2: 'admin2026aa',
      fio: 'Смирнов А. П.', side: 'clinic', role: 'clinic_admin',
    });
    const applicant = await auth.register({
      inn: '7712345671', login: 'ivanova', password: 'vkk2026lead', password2: 'vkk2026lead',
      fio: 'Иванова М. А.', side: 'clinic', role: 'vkk_lead',
    });
    if (!admin.ok || !applicant.ok) throw new Error('setup failed');
    expect(applicant.pending).toBe(true);

    const pendingList = await auth.listPendingForClinic(admin.account);
    expect(pendingList.map((a) => a.id)).toEqual([applicant.account.id]);

    const approved = await auth.approveClinicAccount(admin.account, applicant.account.id, 'vkk_lead');
    expect(approved.ok).toBe(true);
    if (approved.ok) expect(approved.account.pending).toBe(false);

    const login = await auth.login('7712345671', 'ivanova', 'vkk2026lead', {});
    expect(login.ok).toBe(true);
  });

  it('КРИТИЧНО: администратор клиники А не может подтвердить или отклонить заявку клиники Б', async () => {
    const adminA = await auth.register({
      inn: '7712345671', login: 'adminA', password: 'admin2026aa', password2: 'admin2026aa',
      fio: 'A', side: 'clinic', role: 'clinic_admin',
    });
    await auth.register({
      inn: '5001007322', login: 'adminB', password: 'admin2026bb', password2: 'admin2026bb',
      fio: 'B', side: 'clinic', role: 'clinic_admin',
    });
    const applicantB = await auth.register({
      inn: '5001007322', login: 'staffB', password: 'staffB2026', password2: 'staffB2026',
      fio: 'C', side: 'clinic', role: 'nurse',
    });
    if (!adminA.ok || !applicantB.ok) throw new Error('setup failed');

    // assertTenantScope бросает (как и везде в приложении — обобщённый обработчик HTTP превращает это в 403/500)
    await expect(auth.approveClinicAccount(adminA.account, applicantB.account.id, 'nurse')).rejects.toThrow('tenant:scope');
    await expect(auth.rejectClinicAccount(adminA.account, applicantB.account.id)).rejects.toThrow('tenant:scope');

    // заявка чужой клиники осталась нетронутой
    const stillPending = await auth.listPendingForClinic(adminA.account);
    expect(stillPending).toEqual([]);
  });

  it('администратор клиники может закрепить сотрудника за филиалом при подтверждении заявки', async () => {
    const admin = await auth.register({
      inn: '7712345671', login: 'clinicadmin', password: 'admin2026aa', password2: 'admin2026aa',
      fio: 'Смирнов А. П.', side: 'clinic', role: 'clinic_admin',
    });
    const applicant = await auth.register({
      inn: '7712345671', login: 'auditor1', password: 'auditor2026', password2: 'auditor2026',
      fio: 'Козлов Д. Н.', side: 'clinic', role: 'auditor',
    });
    if (!admin.ok || !applicant.ok) throw new Error('setup failed');
    const approved = await auth.approveClinicAccount(admin.account, applicant.account.id, 'auditor', 'Филиал 1');
    expect(approved.ok).toBe(true);
    if (approved.ok) expect(approved.account.branchName).toBe('Филиал 1');
  });

  it('администратор клиники закрепляет и снимает филиал у уже активного сотрудника', async () => {
    const admin = await auth.register({
      inn: '7712345671', login: 'clinicadmin', password: 'admin2026aa', password2: 'admin2026aa',
      fio: 'Смирнов А. П.', side: 'clinic', role: 'clinic_admin',
    });
    if (!admin.ok) throw new Error('setup failed');

    const setBranch = await auth.setAccountBranch(admin.account, admin.account.id, 'Филиал 1');
    expect(setBranch.ok).toBe(true);
    if (setBranch.ok) expect(setBranch.account.branchName).toBe('Филиал 1');

    const cleared = await auth.setAccountBranch(admin.account, admin.account.id, null);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.account.branchName).toBeNull();
  });

  it('КРИТИЧНО: администратор клиники А не может закрепить филиал сотруднику клиники Б', async () => {
    const adminA = await auth.register({
      inn: '7712345671', login: 'adminA', password: 'admin2026aa', password2: 'admin2026aa',
      fio: 'A', side: 'clinic', role: 'clinic_admin',
    });
    const adminB = await auth.register({
      inn: '5001007322', login: 'adminB', password: 'admin2026bb', password2: 'admin2026bb',
      fio: 'B', side: 'clinic', role: 'clinic_admin',
    });
    if (!adminA.ok || !adminB.ok) throw new Error('setup failed');
    await expect(auth.setAccountBranch(adminA.account, adminB.account.id, 'Филиал 1')).rejects.toThrow('tenant:scope');
  });

  it('списки учётных записей: клиники — только свои и без заявок; платформы — только для role:manage', async () => {
    const adminA = await auth.register({ inn: '7712345671', login: 'adminA', password: 'admin2026aa', password2: 'admin2026aa', fio: 'A', side: 'clinic', role: 'clinic_admin' });
    await auth.register({ inn: '7712345671', login: 'pendingP', password: 'admin2026aa', password2: 'admin2026aa', fio: 'P', side: 'clinic', role: 'nurse' });
    await auth.register({ inn: '5001007322', login: 'adminB', password: 'admin2026bb', password2: 'admin2026bb', fio: 'B', side: 'clinic', role: 'clinic_admin' });
    if (!adminA.ok) throw new Error('setup');
    expect((await auth.listClinicAccounts(adminA.account)).map((a) => a.login)).toEqual(['admina']);
    await expect(auth.listPlatformStaff(adminA.account)).rejects.toThrow();
  });

  it('администратор клиники отклоняет заявку — учётная запись удаляется и вход становится невозможен', async () => {
    const admin = await auth.register({
      inn: '7712345671', login: 'clinicadmin', password: 'admin2026aa', password2: 'admin2026aa',
      fio: 'Смирнов А. П.', side: 'clinic', role: 'clinic_admin',
    });
    const applicant = await auth.register({
      inn: '7712345671', login: 'ghost', password: 'ghost2026aa', password2: 'ghost2026aa',
      fio: 'X', side: 'clinic', role: 'observer',
    });
    if (!admin.ok || !applicant.ok) throw new Error('setup failed');

    const rejected = await auth.rejectClinicAccount(admin.account, applicant.account.id);
    expect(rejected.ok).toBe(true);
    const login = await auth.login('7712345671', 'ghost', 'ghost2026aa', {});
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
    const sentCode = repos.notifier.sentOtp.at(-1)!.code;
    repos.clock.advanceMs(OTP_TTL_MS + 1000);
    const r = await auth.verifyOtp(reg.account.id, sentCode, {});
    expect(r.ok).toBe(false);
  });

  it('включение 2FA: нужен пароль и контакт, включается только после верного кода, затем вход требует код', async () => {
    const reg = await auth.register({ inn: '7712345671', login: 'medplus', password: 'medplus2026', password2: 'medplus2026', fio: 'x', side: 'clinic', email: 'a@b.ru' });
    if (!reg.ok) throw new Error('setup');
    expect((await auth.start2fa(reg.account.id, 'email', 'wrongpass1')).ok).toBe(false);
    const noPhone = await auth.start2fa(reg.account.id, 'sms', 'medplus2026');
    expect(noPhone.ok).toBe(false);
    expect((await auth.start2fa(reg.account.id, 'email', 'medplus2026')).ok).toBe(true);
    expect(repos.notifier.sentOtp.at(-1)?.to).toBe('a@b.ru');
    expect((await repos.accounts.findById(reg.account.id))?.twoFactor).toBe(false); // без кода не включена

    expect((await auth.confirm2fa(reg.account.id, '000000')).ok).toBe(false);
    expect((await auth.confirm2fa(reg.account.id, repos.notifier.sentOtp.at(-1)!.code)).ok).toBe(true);
    const acc = await repos.accounts.findById(reg.account.id);
    expect(acc?.twoFactor).toBe(true);
    expect(acc?.twoFactorVia).toBe('email');

    const login = await auth.login('7712345671', 'medplus', 'medplus2026', {});
    expect(login.ok && 'needOtp' in login).toBe(true);
    // код для входа не подходит как код включения и наоборот — цели разные
    expect((await auth.confirm2fa(reg.account.id, repos.notifier.sentOtp.at(-1)!.code)).ok).toBe(false);
  });

  it('отключение 2FA требует пароль; вход снова без кода', async () => {
    const reg = await auth.register({ inn: '7712345671', login: 'medplus', password: 'medplus2026', password2: 'medplus2026', fio: 'x', side: 'clinic', email: 'a@b.ru' });
    if (!reg.ok) throw new Error('setup');
    await repos.accounts.update(reg.account.id, { twoFactor: true, twoFactorVia: 'email' });
    expect((await auth.disable2fa(reg.account.id, 'wrongpass1')).ok).toBe(false);
    expect((await repos.accounts.findById(reg.account.id))?.twoFactor).toBe(true);
    expect((await auth.disable2fa(reg.account.id, 'medplus2026')).ok).toBe(true);
    const login = await auth.login('7712345671', 'medplus', 'medplus2026', {});
    expect(login.ok && 'session' in login).toBe(true);
  });

  it('вход исполнителя по телефону тоже требует код 2FA (не обход)', async () => {
    const reg = await auth.register({ inn: '7712345671', login: 'nurse1', password: 'nurse2026pw', password2: 'nurse2026pw', fio: 'Н', side: 'clinic', role: 'nurse' });
    if (!reg.ok) throw new Error('setup');
    await repos.accounts.update(reg.account.id, { role: 'nurse', phone: normPhone('+79160000005'), pending: false, twoFactor: true, twoFactorVia: 'sms' });
    const r = await auth.loginByPhone('7712345671', '+79160000005', 'nurse2026pw', {});
    expect(r.ok && 'needOtp' in r).toBe(true);
    const code = repos.notifier.sentOtp.at(-1)!.code;
    expect((await auth.verifyOtp(reg.account.id, code, {})).ok).toBe(true);
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
    const code = repos.notifier.sentReset.at(-1)!.code;
    const confirm = await auth.confirmReset(reg.account.id, code, 'newpass123', 'newpass123');
    expect(confirm.ok).toBe(true);
    const login = await auth.login('7712345671', 'medplus', 'newpass123', {});
    expect(login.ok).toBe(true);
  });

  it('сброс пароля уходит на почту, если телефона нет', async () => {
    const reg = await auth.register({ inn: '7712345671', login: 'mailonly', password: 'medplus2026', password2: 'medplus2026', fio: 'x', side: 'clinic', email: 'a@b.ru' });
    if (!reg.ok) throw new Error('setup');
    await auth.requestReset('7712345671', 'mailonly');
    expect(repos.notifier.sentReset.at(-1)).toMatchObject({ via: 'email', to: 'a@b.ru' });
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
