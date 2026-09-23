import type { Role } from '@kontur785/shared';
import type {
  Account,
  AuditLogEntry,
  ChannelRecord,
  DocumentGrantRow,
  GrantEvent,
  OtpCode,
  OtpPurpose,
  SecondHandRequest,
  SecondHandStatus,
  Session,
} from './types.js';

/** Порт репозитория учётных записей. Реализации: infra/memory (тесты), infra/prisma (прод). */
export interface AccountRepo {
  create(acc: Omit<Account, 'id' | 'createdAt' | 'lastLoginAt' | 'approvedById' | 'approvedAt' | 'passwordChangedAt'>): Promise<Account>;
  findById(id: string): Promise<Account | null>;
  findByInnLogin(inn: string, login: string): Promise<Account | null>;
  findByInnPhone(inn: string, phone: string): Promise<Account | null>;
  listPending(): Promise<Account[]>;
  update(id: string, patch: Partial<Account>): Promise<Account>;
  delete(id: string): Promise<void>;
}

export interface SessionRepo {
  create(accountId: string, ttlMs: number, meta: { userAgent?: string | null; ip?: string | null }): Promise<Session>;
  findActiveById(id: string): Promise<Session | null>;
  revoke(id: string): Promise<void>;
}

export interface OtpRepo {
  create(accountId: string, purpose: OtpPurpose, codeHash: string, via: 'sms' | 'email', ttlMs: number): Promise<OtpCode>;
  findLatestActive(accountId: string, purpose: OtpPurpose): Promise<OtpCode | null>;
  consume(id: string): Promise<void>;
}

export interface AuditLog {
  /** Только добавление — отказ в праве тоже пишется (CLAUDE.md). */
  append(entry: Omit<AuditLogEntry, 'id' | 'at'>): Promise<void>;
  list(filter: { tenantInn?: string; actorId?: string; limit?: number }): Promise<AuditLogEntry[]>;
}

export interface SecondHandRepo {
  create(req: Omit<SecondHandRequest, 'id' | 'requestedAt' | 'status' | 'confirmedById' | 'confirmedAt'>): Promise<SecondHandRequest>;
  findById(id: string): Promise<SecondHandRequest | null>;
  setStatus(id: string, status: SecondHandStatus, confirmedById: string | null): Promise<SecondHandRequest>;
}

export interface DocumentGrantRepo {
  appendEvent(row: Omit<DocumentGrantRow, 'id' | 'at'>): Promise<DocumentGrantRow>;
  /** Последнее событие по (tenantInn, code): активна, если это 'grant'. */
  latestEvent(tenantInn: string, code: string): Promise<DocumentGrantRow | null>;
  listForTenant(tenantInn: string): Promise<DocumentGrantRow[]>;
}

export interface ChannelStore {
  get<T = unknown>(scope: 'platform' | 'tenant', tenantInn: string | null, key: string, fallback: T): Promise<ChannelRecord<T>>;
  /** Запись с проверкой версии — конфликт возвращается вызывающему, а не затирается молча. */
  set<T = unknown>(
    scope: 'platform' | 'tenant',
    tenantInn: string | null,
    key: string,
    value: T,
    opts: { expectedVersion?: number; updatedBy: string | null },
  ): Promise<{ ok: true; version: number } | { ok: false; conflict: true; version: number }>;
}

export interface ExecutorMarkRepo {
  markDone(accountId: string, itemKey: string, label: string): Promise<void>;
  listForAccount(accountId: string): Promise<Record<string, string>>; // itemKey -> ISO date
}

/** Абстракция канала доставки — на проде реальный SMS/email-шлюз, в деве/тестах — консоль/память. */
export interface Notifier {
  sendOtp(via: 'sms' | 'email', to: string, code: string): Promise<void>;
  sendPasswordReset(via: 'sms' | 'email', to: string, code: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface Repos {
  accounts: AccountRepo;
  sessions: SessionRepo;
  otps: OtpRepo;
  auditLog: AuditLog;
  secondHand: SecondHandRepo;
  documentGrants: DocumentGrantRepo;
  channels: ChannelStore;
  executorMarks: ExecutorMarkRepo;
  notifier: Notifier;
  clock: Clock;
}

export type { Role };
