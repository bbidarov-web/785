import { randomUUID } from 'node:crypto';
import type { AuditLog, Clock } from '../../domain/ports.js';
import type { AuditLogEntry } from '../../domain/types.js';
import { computeEntryHash, verifyChain } from '../../audit/chain.js';

/** Секрет по умолчанию — только для тестов/дев-стенда без реального AUDIT_LOG_SECRET (см. env.ts). */
const DEV_SECRET = 'dev-only-audit-secret-not-for-production-use-x';

/**
 * Только добавление. `append` — единственный мутирующий метод, и он не заменяет,
 * а дописывает — этим же свойством должна обладать таблица в Postgres
 * (см. apps/api/prisma/hardening.sql). Каждая запись подписана HMAC-цепочкой
 * (audit/chain.ts) — подмена/удаление строки в обход интерфейса ломает цепочку.
 */
export class InMemoryAuditLog implements AuditLog {
  private rows: AuditLogEntry[] = [];
  private lastHash: string | null = null;
  private seq = 0;
  constructor(private clock: Clock, private secret: string = DEV_SECRET) {}

  async append(entry: Omit<AuditLogEntry, 'id' | 'at' | 'seq' | 'prevHash' | 'hash'>): Promise<void> {
    this.seq += 1;
    const base = { ...entry, seq: this.seq, at: this.clock.now() };
    const prevHash = this.lastHash;
    const hash = computeEntryHash(this.secret, prevHash, base);
    this.lastHash = hash;
    this.rows.push({ ...base, id: 'log_' + randomUUID(), prevHash, hash });
  }

  async list(filter: { tenantInn?: string; actorId?: string; limit?: number }): Promise<AuditLogEntry[]> {
    let out = this.rows;
    if (filter.tenantInn) out = out.filter((r) => r.tenantInn === filter.tenantInn);
    if (filter.actorId) out = out.filter((r) => r.actorId === filter.actorId);
    out = out.slice().sort((a, b) => b.at.getTime() - a.at.getTime());
    return filter.limit ? out.slice(0, filter.limit) : out;
  }

  async verifyChain(): Promise<{ ok: boolean; brokenAtSeq: number | null }> {
    return verifyChain(this.secret, this.rows); // уже в порядке добавления (по возрастанию seq)
  }
}
