import type { Role } from '@kontur785/shared';

export type AccountSide = 'platform' | 'clinic';
export type TwoFactorVia = 'sms' | 'email';

export interface Account {
  id: string;
  inn: string;
  login: string;
  phone: string | null;
  email: string | null;
  org: string | null;
  fio: string;
  side: AccountSide;
  role: Role;
  pending: boolean;
  requestedRole: Role | null;
  /** Ограничивает видимость плана проверок и оборудования СВОИМ филиалом (Branch.name) — null значит без ограничения (SERVER.md, README «Объекты как первый класс»). */
  branchName: string | null;
  passwordHash: string;
  twoFactor: boolean;
  twoFactorVia: TwoFactorVia;
  blocked: boolean;
  mustChange: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  approvedById: string | null;
  approvedAt: Date | null;
  passwordChangedAt: Date | null;
}

export interface Session {
  id: string;
  accountId: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
  revokedAt: Date | null;
}

export type OtpPurpose = 'login_2fa' | 'password_reset' | 'enable_2fa';

export interface OtpCode {
  id: string;
  accountId: string;
  purpose: OtpPurpose;
  codeHash: string;
  via: TwoFactorVia;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface AuditLogEntry {
  id: string;
  seq: number;
  at: Date;
  actorId: string | null;
  actorRole: Role | null;
  tenantInn: string | null;
  action: string;
  target: string | null;
  meta: Record<string, unknown> | null;
  allowed: boolean;
  /** Хеш предыдущей записи цепочки — null только у самой первой записи хранилища. */
  prevHash: string | null;
  /** HMAC-SHA256(секрет сервера, prevHash + канонический вид этой записи) — см. auditChain.ts. Подмена/удаление записи в обход интерфейса рвёт цепочку с этого места. */
  hash: string;
}

export type SecondHandStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';

export interface SecondHandRequest {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  tenantInn: string | null;
  requestedById: string;
  requestedAt: Date;
  status: SecondHandStatus;
  confirmedById: string | null;
  confirmedAt: Date | null;
  expiresAt: Date;
}

export type GrantEvent = 'grant' | 'revoke';

export interface DocumentGrantRow {
  id: string;
  /** Автоинкремент — источник истины для "последнего" события (см. hardening-заметку в DocumentGrantRepo). */
  seq?: number;
  tenantInn: string;
  stage: string;
  code: string;
  name: string;
  event: GrantEvent;
  byAccountId: string;
  byRole: Role;
  at: Date;
  paid: boolean;
}

export interface ChannelRecord<T = unknown> {
  data: T;
  version: number;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface SessionContext {
  session: Session;
  account: Account;
  /** Арендатор берётся ТОЛЬКО из сессии (CLAUDE.md), никогда из параметра запроса. */
  tenantInn: string | null;
}
