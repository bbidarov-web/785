import { createHash, randomBytes } from 'node:crypto';
import { isClinicRole, type Role } from '@kontur785/shared';
import type { Account } from '../domain/types.js';
import type { Repos } from '../domain/ports.js';
import { assertPermission } from '../rbac/service.js';

const CHANNEL = 'invites';
const TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

interface InviteRecord {
  id: string;
  tokenHash: string;
  role: Role;
  branchName: string | null;
  createdById: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface InviteView {
  id: string;
  role: Role;
  branchName: string | null;
  createdAt: string;
  expiresAt: string;
}

/** Данные приглашения, достаточные форме регистрации, чтобы показать «вас приглашает клинику…». */
export interface InvitePreview {
  inn: string;
  org: string;
  role: Role;
  branchName: string | null;
}

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

/**
 * Приглашение сотрудника ссылкой вместо заявки «по публичному ИНН» (auth/service.ts register):
 * администратор клиники заранее задаёт роль и филиал, получатель регистрируется сам и сразу
 * получает доступ. В хранилище — только хеш секрета: утечка данных не даёт готовых ссылок.
 * Токен вида `<ИНН>.<секрет>`: ИНН нужен, чтобы найти клинику (записи лежат в её канале).
 */
export class InviteStore {
  constructor(private repos: Repos) {}

  private parse(token: string): { inn: string; secret: string } | null {
    const [inn, secret, ...rest] = String(token ?? '').split('.');
    if (!inn || !secret || rest.length || !/^\d{10}(\d{2})?$/.test(inn)) return null;
    return { inn, secret };
  }

  private async load(inn: string) {
    return this.repos.channels.get<InviteRecord[]>('tenant', inn, CHANNEL, []);
  }

  private async save(inn: string, list: InviteRecord[], version: number, by: string | null): Promise<boolean> {
    const res = await this.repos.channels.set('tenant', inn, CHANNEL, JSON.parse(JSON.stringify(list)), { expectedVersion: version, updatedBy: by });
    return res.ok;
  }

  private active(r: InviteRecord): boolean {
    return !r.usedAt && new Date(r.expiresAt).getTime() > this.repos.clock.now().getTime();
  }

  async create(account: Account, role: Role, branchName: string | null): Promise<{ ok: true; token: string; invite: InviteView } | { ok: false; error: string }> {
    await assertPermission(this.repos.auditLog, account, 'staff:manage', 'invite:create', role, account.inn);
    if (!isClinicRole(role)) return { ok: false, error: 'Эта роль не предназначена для клиники' };
    const secret = randomBytes(24).toString('base64url');
    const now = this.repos.clock.now();
    const rec: InviteRecord = {
      id: randomBytes(6).toString('hex'),
      tokenHash: hash(secret),
      role,
      branchName: branchName?.trim() || null,
      createdById: account.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TTL_DAYS * DAY_MS).toISOString(),
      usedAt: null,
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await this.load(account.inn);
      // использованные и просроченные не копим — список не растёт бесконечно
      const next = [...cur.data.filter((r) => this.active(r)), rec];
      if (await this.save(account.inn, next, cur.version, account.id)) {
        await this.repos.auditLog.append({ actorId: account.id, actorRole: account.role, tenantInn: account.inn, action: 'invite:create', target: rec.id, meta: { role, branchName: rec.branchName }, allowed: true });
        return { ok: true, token: `${account.inn}.${secret}`, invite: this.view(rec) };
      }
    }
    return { ok: false, error: 'Не удалось создать приглашение — повторите' };
  }

  private view(r: InviteRecord): InviteView {
    return { id: r.id, role: r.role, branchName: r.branchName, createdAt: r.createdAt, expiresAt: r.expiresAt };
  }

  async list(account: Account): Promise<InviteView[]> {
    await assertPermission(this.repos.auditLog, account, 'staff:manage', 'invite:list', account.inn, account.inn);
    return (await this.load(account.inn)).data.filter((r) => this.active(r)).map((r) => this.view(r));
  }

  async revoke(account: Account, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    await assertPermission(this.repos.auditLog, account, 'staff:manage', 'invite:revoke', id, account.inn);
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await this.load(account.inn);
      if (!cur.data.some((r) => r.id === id && this.active(r))) return { ok: false, error: 'Приглашение не найдено или уже использовано' };
      if (await this.save(account.inn, cur.data.filter((r) => r.id !== id), cur.version, account.id)) {
        await this.repos.auditLog.append({ actorId: account.id, actorRole: account.role, tenantInn: account.inn, action: 'invite:revoke', target: id, meta: null, allowed: true });
        return { ok: true };
      }
    }
    return { ok: false, error: 'Не удалось отозвать — повторите' };
  }

  /** Публичная проверка ссылки (без входа): годна ли она и для какой клиники/роли. */
  async peek(token: string): Promise<InvitePreview | null> {
    const t = this.parse(token);
    if (!t) return null;
    const rec = (await this.load(t.inn)).data.find((r) => r.tokenHash === hash(t.secret) && this.active(r));
    if (!rec) return null;
    const tenant = await this.repos.tenants.findByInn(t.inn);
    return { inn: t.inn, org: tenant?.name ?? `ИНН ${t.inn}`, role: rec.role, branchName: rec.branchName };
  }

  /** Занять приглашение (одноразово, CAS против двойного использования). null — ссылка недействительна. */
  async claim(token: string): Promise<{ inn: string; role: Role; branchName: string | null; createdById: string } | null> {
    const t = this.parse(token);
    if (!t) return null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await this.load(t.inn);
      const rec = cur.data.find((r) => r.tokenHash === hash(t.secret) && this.active(r));
      if (!rec) return null;
      const next = cur.data.map((r) => (r.id === rec.id ? { ...r, usedAt: this.repos.clock.now().toISOString() } : r));
      if (await this.save(t.inn, next, cur.version, rec.createdById)) {
        return { inn: t.inn, role: rec.role, branchName: rec.branchName, createdById: rec.createdById };
      }
    }
    return null;
  }
}
