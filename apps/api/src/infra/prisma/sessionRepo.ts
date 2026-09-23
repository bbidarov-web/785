import type { PrismaClient } from '@prisma/client';
import type { SessionRepo } from '../../domain/ports.js';
import type { Session } from '../../domain/types.js';

export class PrismaSessionRepo implements SessionRepo {
  constructor(private prisma: PrismaClient) {}

  async create(accountId: string, ttlMs: number, meta: { userAgent?: string | null; ip?: string | null }): Promise<Session> {
    return this.prisma.session.create({
      data: { accountId, expiresAt: new Date(Date.now() + ttlMs), userAgent: meta.userAgent ?? null, ip: meta.ip ?? null },
    });
  }

  async findActiveById(id: string): Promise<Session | null> {
    const row = await this.prisma.session.findUnique({ where: { id } });
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return null;
    return row;
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.session.update({ where: { id }, data: { revokedAt: new Date() } }).catch(() => undefined);
  }
}
