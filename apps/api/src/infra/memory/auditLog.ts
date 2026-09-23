import { randomUUID } from 'node:crypto';
import type { AuditLog, Clock } from '../../domain/ports.js';
import type { AuditLogEntry } from '../../domain/types.js';

/**
 * Только добавление. `push` — единственный мутирующий метод, и он не заменяет,
 * а дописывает — этим же свойством должна обладать таблица в Postgres
 * (см. apps/api/prisma/hardening.sql).
 */
export class InMemoryAuditLog implements AuditLog {
  private rows: AuditLogEntry[] = [];
  constructor(private clock: Clock) {}

  async append(entry: Omit<AuditLogEntry, 'id' | 'at'>): Promise<void> {
    this.rows.push({ ...entry, id: 'log_' + randomUUID(), at: this.clock.now() });
  }

  async list(filter: { tenantInn?: string; actorId?: string; limit?: number }): Promise<AuditLogEntry[]> {
    let out = this.rows;
    if (filter.tenantInn) out = out.filter((r) => r.tenantInn === filter.tenantInn);
    if (filter.actorId) out = out.filter((r) => r.actorId === filter.actorId);
    out = out.slice().sort((a, b) => b.at.getTime() - a.at.getTime());
    return filter.limit ? out.slice(0, filter.limit) : out;
  }
}
