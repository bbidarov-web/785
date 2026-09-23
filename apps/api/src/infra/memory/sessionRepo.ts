import { randomUUID } from 'node:crypto';
import type { Clock, SessionRepo } from '../../domain/ports.js';
import type { Session } from '../../domain/types.js';

export class InMemorySessionRepo implements SessionRepo {
  private rows: Session[] = [];
  constructor(private clock: Clock) {}

  async create(accountId: string, ttlMs: number, meta: { userAgent?: string | null; ip?: string | null }): Promise<Session> {
    const now = this.clock.now();
    const row: Session = {
      id: 'ses_' + randomUUID(),
      accountId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
      revokedAt: null,
    };
    this.rows.push(row);
    return row;
  }

  async findActiveById(id: string): Promise<Session | null> {
    const row = this.rows.find((s) => s.id === id);
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() <= this.clock.now().getTime()) return null;
    return row;
  }

  async revoke(id: string): Promise<void> {
    const row = this.rows.find((s) => s.id === id);
    if (row) row.revokedAt = this.clock.now();
  }
}
