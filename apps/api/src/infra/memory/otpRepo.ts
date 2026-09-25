import { randomUUID } from 'node:crypto';
import type { Clock, OtpRepo } from '../../domain/ports.js';
import type { OtpCode, OtpPurpose } from '../../domain/types.js';

export class InMemoryOtpRepo implements OtpRepo {
  private rows: OtpCode[] = [];
  constructor(private clock: Clock) {}

  async create(accountId: string, purpose: OtpPurpose, codeHash: string, via: 'sms' | 'email', ttlMs: number): Promise<OtpCode> {
    const now = this.clock.now();
    const row: OtpCode = {
      id: 'otp_' + randomUUID(),
      accountId,
      purpose,
      codeHash,
      via,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      consumedAt: null,
    };
    this.rows.push(row);
    return row;
  }

  async findLatestActive(accountId: string, purpose: OtpPurpose): Promise<OtpCode | null> {
    const now = this.clock.now().getTime();
    const candidates = this.rows
      .filter((r) => r.accountId === accountId && r.purpose === purpose && !r.consumedAt && r.expiresAt.getTime() > now)
      .reverse() // при равных отметках времени (замороженные часы тестов) побеждает более поздняя запись
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return candidates[0] ?? null;
  }

  async consume(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.consumedAt = this.clock.now();
  }
}
