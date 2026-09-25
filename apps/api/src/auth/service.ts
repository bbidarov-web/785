import { normInn, normPhone, passwordIssues, validInn, innChecksum, isRole, isClinicRole, isPlatformRole, type Role } from '@kontur785/shared';
import { OTP_TTL_MS, RESET_TTL_MS, SESSION_TTL_MS } from '@kontur785/shared';
import type { Repos } from '../domain/ports.js';
import type { Account, Session } from '../domain/types.js';
import { assertPermission, assertTenantScope } from '../rbac/service.js';
import { generateOtp, hashCode, hashPassword, verifyCode, verifyPassword } from './hash.js';

export type Result<T> = { ok: true } & T | { ok: false; error: string };

export interface PublicAccount {
  id: string;
  login: string;
  fio: string;
  phone: string | null;
  email: string | null;
  side: Account['side'];
  role: Role;
  requestedRole: Role | null;
  branchName: string | null;
  createdAt: Date;
}

/** Проекция Account без passwordHash и прочих внутренних полей — единственное, что можно отдавать в ответ HTTP (CLAUDE.md: не логировать/не светить секреты). */
export function toPublicAccount(a: Account): PublicAccount {
  return { id: a.id, login: a.login, fio: a.fio, phone: a.phone, email: a.email, side: a.side, role: a.role, requestedRole: a.requestedRole, branchName: a.branchName, createdAt: a.createdAt };
}

export interface RegisterInput {
  inn: string;
  login: string;
  password: string;
  password2: string;
  org?: string;
  fio?: string;
  phone?: string;
  email?: string;
  side: 'clinic' | 'operator';
  role?: Role;
}

/**
 * Аутентификация — перенос бизнес-правил `reference/prototype/auth.js` на сервер:
 * реальный хеш вместо отпечатка, сессия в БД вместо localStorage, код 2FA/сброса
 * никогда не возвращается вызывающему (SERVER.md §6.1, §7).
 */
export class AuthService {
  constructor(private repos: Repos) {}

  async register(input: RegisterInput): Promise<Result<{ account: Account; pending: boolean; warn: string }>> {
    const inn = normInn(input.inn);
    const login = String(input.login ?? '').trim().toLowerCase();
    if (!validInn(inn)) return { ok: false, error: 'ИНН должен содержать 10 цифр для юрлица или 12 для ИП' };
    if (login.length < 3) return { ok: false, error: 'Логин не короче трёх символов' };
    const issues = passwordIssues(input.password);
    if (issues.length) return { ok: false, error: 'Пароль: ' + issues.join(', ') };
    if (input.password !== input.password2) return { ok: false, error: 'Пароли не совпадают' };
    if (await this.repos.accounts.findByInnLogin(inn, login)) {
      return { ok: false, error: 'Такой логин на этом ИНН уже зарегистрирован' };
    }
    const side: 'platform' | 'clinic' = input.side === 'operator' ? 'platform' : 'clinic';
    if (input.role && !isRole(input.role)) return { ok: false, error: 'Неизвестная роль' };
    const role: Role = input.role && isRole(input.role) ? input.role : side === 'platform' ? 'methodist' : 'clinic_admin';
    // Роль обязана соответствовать стороне регистрации — иначе саморегистрация
    // с side=clinic и произвольной role=platform_admin создала бы АКТИВНУЮ
    // учётную запись с правами всей платформы: для side=clinic заявка никогда
    // не уходит в pending по этой причине (см. ниже — по другой причине уходит).
    if (side === 'clinic' && !isClinicRole(role)) return { ok: false, error: 'Эта роль не предназначена для клиники' };
    if (side === 'platform' && !isPlatformRole(role)) return { ok: false, error: 'Эта роль не предназначена для сотрудника платформы' };
    const passwordHash = await hashPassword(input.password);
    // ИНН организации — публичные данные (ЕГРЮЛ/ФНС). Если клиника с этим ИНН
    // уже существует, саморегистрация не может дать НЕЗНАКОМЦУ немедленный
    // доступ к её данным просто потому, что он знает её ИНН — заявка ждёт
    // подтверждения администратором ЭТОЙ клиники (approveClinicAccount ниже),
    // как и заявка сотрудника платформы ждёt администратора платформы. Только
    // первая регистрация на НОВЫЙ ИНН заводит клинику и пускает сразу.
    const existingTenant = side === 'clinic' ? await this.repos.tenants.findByInn(inn) : null;
    const pending = side === 'platform' || !!existingTenant;
    const account = await this.repos.accounts.create({
      inn,
      login,
      org: input.org?.trim() || null,
      fio: input.fio?.trim() || '',
      // нормализуется тем же алгоритмом, что и поиск в loginByPhone — иначе
      // вход исполнителя по телефону не находит только что созданную запись
      phone: input.phone ? normPhone(input.phone) : null,
      email: input.email?.trim() || null,
      side,
      role,
      pending,
      requestedRole: pending ? role : null,
      branchName: null, // назначается администратором клиники отдельно (approveClinicAccount/setAccountBranch)
      passwordHash,
      twoFactor: false,
      twoFactorVia: 'sms',
      blocked: false,
      mustChange: false,
    });
    // арендатор — клиника (SERVER.md §2); заводим её только на первой регистрации
    // (иначе саморегистрация в чужую клинику переписала бы её название в реестре);
    // сотрудник платформы тенантом не является, для него запись в tenants не заводится
    if (side === 'clinic' && !existingTenant) {
      await this.repos.tenants.upsert(inn, account.org || `ИНН ${inn}`);
    }
    return {
      ok: true,
      account,
      pending,
      warn: innChecksum(inn) ? '' : 'Контрольная сумма ИНН не сходится — проверьте цифры в профиле',
    };
  }

  async listPending(): Promise<Account[]> {
    return this.repos.accounts.listPending();
  }

  /** Начальное подтверждение заявки платформенного сотрудника — не путать с elevateRole (SERVER.md §4). */
  async approveAccount(id: string, role: Role, byAccountId: string): Promise<Result<{ account: Account }>> {
    const acc = await this.repos.accounts.findById(id);
    if (!acc) return { ok: false, error: 'Заявка не найдена' };
    // Заявки в pending всегда со стороны платформы (side=clinic никогда не
    // ждёт подтверждения) — но роль всё равно проверяем на всякий случай,
    // тем же правилом, что и саморегистрация (см. register выше).
    if (acc.side === 'platform' && !isPlatformRole(role)) return { ok: false, error: 'Эта роль не предназначена для сотрудника платформы' };
    if (acc.side === 'clinic' && !isClinicRole(role)) return { ok: false, error: 'Эта роль не предназначена для клиники' };
    const updated = await this.repos.accounts.update(id, {
      pending: false,
      role,
      approvedById: byAccountId,
      approvedAt: this.repos.clock.now(),
    });
    await this.repos.auditLog.append({
      actorId: byAccountId,
      actorRole: null,
      tenantInn: null,
      action: 'account:approve',
      target: id,
      meta: { role },
      allowed: true,
    });
    return { ok: true, account: updated };
  }

  async rejectAccount(id: string, byAccountId: string): Promise<Result<Record<string, unknown>>> {
    const acc = await this.repos.accounts.findById(id);
    if (!acc) return { ok: false, error: 'Заявка не найдена' };
    await this.repos.accounts.delete(id);
    await this.repos.auditLog.append({
      actorId: byAccountId,
      actorRole: null,
      tenantInn: null,
      action: 'account:reject',
      target: id,
      meta: null,
      allowed: true,
    });
    return { ok: true };
  }

  /** Заявки на доступ к СВОЕЙ клинике (README «Доступы и роли») — видит только администратор клиники (`staff:manage`). */
  async listPendingForClinic(account: Account): Promise<Account[]> {
    await assertPermission(this.repos.auditLog, account, 'staff:manage', 'account:list-pending', null, account.inn);
    const rows = await this.repos.accounts.listByInn(account.inn);
    return rows.filter((a) => a.pending);
  }

  /**
   * Подтверждение самостоятельной регистрации сотрудника СВОЕЙ клиники —
   * закрывает саморегистрацию незнакомца в чужую клинику по публичному ИНН
   * (register() выше): заявка существует, но активирует её только администратор
   * ТОЙ ЖЕ клиники, а не автор заявки и не администратор другой клиники.
   */
  async approveClinicAccount(account: Account, id: string, role: Role, branchName?: string | null): Promise<Result<{ account: Account }>> {
    await assertPermission(this.repos.auditLog, account, 'staff:manage', 'account:approve', id, account.inn);
    const acc = await this.repos.accounts.findById(id);
    if (!acc) return { ok: false, error: 'Заявка не найдена' };
    if (acc.side !== 'clinic') return { ok: false, error: 'Заявка относится к сотруднику платформы' };
    assertTenantScope(account, acc.inn); // не позволяет подтвердить заявку ЧУЖОЙ клиники
    if (!isClinicRole(role)) return { ok: false, error: 'Эта роль не предназначена для клиники' };
    const updated = await this.repos.accounts.update(id, {
      pending: false,
      role,
      branchName: branchName?.trim() || null,
      approvedById: account.id,
      approvedAt: this.repos.clock.now(),
    });
    await this.repos.auditLog.append({
      actorId: account.id,
      actorRole: account.role,
      tenantInn: account.inn,
      action: 'account:approve',
      target: id,
      meta: { role, branchName: updated.branchName },
      allowed: true,
    });
    return { ok: true, account: updated };
  }

  /**
   * Закрепление сотрудника ЗА филиалом (README «Объекты как первый класс») —
   * ограничивает его видимость плана и оборудования этим филиалом
   * (rbac/service.ts, visibleToBranch). `branchName: null` снимает ограничение.
   */
  async setAccountBranch(account: Account, id: string, branchName: string | null): Promise<Result<{ account: Account }>> {
    await assertPermission(this.repos.auditLog, account, 'staff:manage', 'account:set-branch', id, account.inn);
    const acc = await this.repos.accounts.findById(id);
    if (!acc) return { ok: false, error: 'Учётная запись не найдена' };
    if (acc.side !== 'clinic') return { ok: false, error: 'Учётная запись относится к сотруднику платформы' };
    assertTenantScope(account, acc.inn);
    const updated = await this.repos.accounts.update(id, { branchName: branchName?.trim() || null });
    await this.repos.auditLog.append({
      actorId: account.id, actorRole: account.role, tenantInn: account.inn,
      action: 'account:set-branch', target: id, meta: { branchName: updated.branchName }, allowed: true,
    });
    return { ok: true, account: updated };
  }

  async rejectClinicAccount(account: Account, id: string): Promise<Result<Record<string, unknown>>> {
    await assertPermission(this.repos.auditLog, account, 'staff:manage', 'account:reject', id, account.inn);
    const acc = await this.repos.accounts.findById(id);
    if (!acc) return { ok: false, error: 'Заявка не найдена' };
    if (acc.side !== 'clinic') return { ok: false, error: 'Заявка относится к сотруднику платформы' };
    assertTenantScope(account, acc.inn);
    await this.repos.accounts.delete(id);
    await this.repos.auditLog.append({
      actorId: account.id,
      actorRole: account.role,
      tenantInn: account.inn,
      action: 'account:reject',
      target: id,
      meta: null,
      allowed: true,
    });
    return { ok: true };
  }

  private async openSession(acc: Account, meta: { userAgent?: string | null; ip?: string | null }): Promise<Session> {
    await this.repos.accounts.update(acc.id, { lastLoginAt: this.repos.clock.now() });
    return this.repos.sessions.create(acc.id, SESSION_TTL_MS, meta);
  }

  async login(
    inn: string,
    login: string,
    password: string,
    meta: { userAgent?: string | null; ip?: string | null },
  ): Promise<Result<{ session: Session } | { needOtp: true; via: string }>> {
    const acc = await this.repos.accounts.findByInnLogin(normInn(inn), login);
    // ответ намеренно не различает «нет такого логина» и «неверный пароль»
    const valid = acc ? await verifyPassword(acc.passwordHash, password) : false;
    if (!acc || !valid) {
      await this.repos.auditLog.append({ actorId: null, actorRole: null, tenantInn: null, action: 'auth:login', target: login, meta: { inn: normInn(inn) }, allowed: false });
      return { ok: false, error: 'Неверный ИНН, логин или пароль' };
    }
    if (acc.blocked) return { ok: false, error: 'Доступ приостановлен. Обратитесь к администратору платформы.' };
    if (acc.pending) {
      const who = acc.side === 'platform' ? 'администратора платформы' : 'администратора клиники';
      return { ok: false, error: `Заявка на доступ отправлена и ждёт подтверждения ${who}.` };
    }
    if (acc.twoFactor) {
      const code = generateOtp();
      const codeHash = await hashCode(code);
      await this.repos.otps.create(acc.id, 'login_2fa', codeHash, acc.twoFactorVia, OTP_TTL_MS);
      const to = acc.twoFactorVia === 'email' ? acc.email ?? '' : acc.phone ?? '';
      await this.repos.notifier.sendOtp(acc.twoFactorVia, to, code);
      return { ok: true, needOtp: true, via: acc.twoFactorVia };
    }
    const session = await this.openSession(acc, meta);
    await this.repos.auditLog.append({ actorId: acc.id, actorRole: acc.role, tenantInn: acc.side === 'clinic' ? acc.inn : null, action: 'auth:login', target: acc.id, meta: null, allowed: true });
    return { ok: true, session };
  }

  async loginByPhone(
    inn: string,
    phone: string,
    password: string,
    meta: { userAgent?: string | null; ip?: string | null },
  ): Promise<Result<{ session: Session }>> {
    const acc = await this.repos.accounts.findByInnPhone(normInn(inn), normPhone(phone));
    const valid = acc ? await verifyPassword(acc.passwordHash, password) : false;
    if (!acc || !valid) {
      await this.repos.auditLog.append({ actorId: null, actorRole: null, tenantInn: normInn(inn), action: 'auth:login-by-phone', target: null, meta: null, allowed: false });
      return { ok: false, error: 'Неверный ИНН клиники, телефон или пароль' };
    }
    if (acc.blocked) return { ok: false, error: 'Доступ приостановлен. Обратитесь к администратору клиники.' };
    if (acc.pending) return { ok: false, error: 'Доступ ещё не подтверждён клиникой.' };
    if (acc.role !== 'nurse') {
      return { ok: false, error: 'Эта учётная запись — не исполнитель. Войдите в кабинет клиники.' };
    }
    const session = await this.openSession(acc, meta);
    await this.repos.auditLog.append({ actorId: acc.id, actorRole: acc.role, tenantInn: acc.inn, action: 'auth:login-by-phone', target: acc.id, meta: null, allowed: true });
    return { ok: true, session };
  }

  async verifyOtp(accountId: string, code: string, meta: { userAgent?: string | null; ip?: string | null }): Promise<Result<{ session: Session }>> {
    const rec = await this.repos.otps.findLatestActive(accountId, 'login_2fa');
    if (!rec) return { ok: false, error: 'Код не запрашивался или просрочен, запросите новый' };
    if (!(await verifyCode(rec.codeHash, code))) return { ok: false, error: 'Код не совпадает' };
    const acc = await this.repos.accounts.findById(accountId);
    if (!acc) return { ok: false, error: 'Учётная запись не найдена' };
    await this.repos.otps.consume(rec.id);
    const session = await this.openSession(acc, meta);
    return { ok: true, session };
  }

  async resendOtp(accountId: string): Promise<Result<{ via: string }>> {
    const acc = await this.repos.accounts.findById(accountId);
    if (!acc) return { ok: false, error: 'Учётная запись не найдена' };
    const code = generateOtp();
    const codeHash = await hashCode(code);
    await this.repos.otps.create(acc.id, 'login_2fa', codeHash, acc.twoFactorVia, OTP_TTL_MS);
    const to = acc.twoFactorVia === 'email' ? acc.email ?? '' : acc.phone ?? '';
    await this.repos.notifier.sendOtp(acc.twoFactorVia, to, code);
    return { ok: true, via: acc.twoFactorVia };
  }

  async requestReset(inn: string, login: string): Promise<{ ok: true; sent: true }> {
    const acc = await this.repos.accounts.findByInnLogin(normInn(inn), login);
    // ответ одинаковый независимо от того, найдена запись или нет
    if (!acc) return { ok: true, sent: true };
    const code = generateOtp();
    const codeHash = await hashCode(code);
    // канал — предпочтительный, но только если по нему есть куда слать: клиника,
    // зарегистрированная с одной почтой, иначе никогда не получила бы код сброса
    const via = acc.twoFactorVia === 'email' ? (acc.email ? 'email' : 'sms') : (acc.phone ? 'sms' : 'email');
    await this.repos.otps.create(acc.id, 'password_reset', codeHash, via, RESET_TTL_MS);
    const to = via === 'email' ? acc.email ?? '' : acc.phone ?? '';
    await this.repos.notifier.sendPasswordReset(via, to, code);
    return { ok: true, sent: true };
  }

  async confirmReset(accountId: string, code: string, password: string, password2: string): Promise<Result<Record<string, unknown>>> {
    const rec = await this.repos.otps.findLatestActive(accountId, 'password_reset');
    if (!rec) return { ok: false, error: 'Код не запрашивался или просрочен, запросите новый' };
    if (!(await verifyCode(rec.codeHash, code))) return { ok: false, error: 'Код не совпадает' };
    const issues = passwordIssues(password);
    if (issues.length) return { ok: false, error: 'Пароль: ' + issues.join(', ') };
    if (password !== password2) return { ok: false, error: 'Пароли не совпадают' };
    const passwordHash = await hashPassword(password);
    await this.repos.accounts.update(accountId, { passwordHash, passwordChangedAt: this.repos.clock.now() });
    await this.repos.otps.consume(rec.id);
    return { ok: true };
  }

  async changePassword(accountId: string, oldPass: string, newPass: string, newPass2: string): Promise<Result<Record<string, unknown>>> {
    const acc = await this.repos.accounts.findById(accountId);
    if (!acc) return { ok: false, error: 'Учётная запись не найдена' };
    if (!(await verifyPassword(acc.passwordHash, oldPass))) return { ok: false, error: 'Текущий пароль неверен' };
    const issues = passwordIssues(newPass);
    if (issues.length) return { ok: false, error: 'Новый пароль: ' + issues.join(', ') };
    if (newPass !== newPass2) return { ok: false, error: 'Новые пароли не совпадают' };
    if (newPass === oldPass) return { ok: false, error: 'Новый пароль совпадает с текущим' };
    const passwordHash = await hashPassword(newPass);
    await this.repos.accounts.update(accountId, { passwordHash, passwordChangedAt: this.repos.clock.now(), mustChange: false });
    return { ok: true };
  }

  /** Администратор меняет пароль сотрудника, не зная старого — необратимо, обязательно журналируется. */
  async adminSetPassword(accountId: string, newPass: string, byAccountId: string): Promise<Result<Record<string, unknown>>> {
    const acc = await this.repos.accounts.findById(accountId);
    if (!acc) return { ok: false, error: 'Учётная запись не найдена' };
    const issues = passwordIssues(newPass);
    if (issues.length) return { ok: false, error: 'Пароль: ' + issues.join(', ') };
    const passwordHash = await hashPassword(newPass);
    await this.repos.accounts.update(accountId, { passwordHash, passwordChangedAt: this.repos.clock.now(), mustChange: true });
    await this.repos.auditLog.append({ actorId: byAccountId, actorRole: null, tenantInn: null, action: 'account:admin-set-password', target: accountId, meta: null, allowed: true });
    return { ok: true };
  }

  async logout(sessionId: string): Promise<void> {
    await this.repos.sessions.revoke(sessionId);
  }

  async getSessionContext(sessionId: string): Promise<{ session: Session; account: Account } | null> {
    const session = await this.repos.sessions.findActiveById(sessionId);
    if (!session) return null;
    const account = await this.repos.accounts.findById(session.accountId);
    if (!account || account.blocked) return null;
    return { session, account };
  }
}
