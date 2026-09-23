import type { PrismaClient, Prisma } from '@prisma/client';
import type { AuditLog } from '../../domain/ports.js';
import type { AuditLogEntry } from '../../domain/types.js';

/** Только INSERT — см. `prisma/hardening.sql` для отказа в UPDATE/DELETE на уровне БД. */
export class PrismaAuditLog implements AuditLog {
  constructor(private prisma: PrismaClient) {}

  async append(entry: Omit<AuditLogEntry, 'id' | 'at'>): Promise<void> {
    await this.prisma.auditLogEntry.create({
      data: {
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        tenantInn: entry.tenantInn,
        action: entry.action,
        target: entry.target,
        meta: (entry.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        allowed: entry.allowed,
      },
    });
  }

  async list(filter: { tenantInn?: string; actorId?: string; limit?: number }): Promise<AuditLogEntry[]> {
    const rows = await this.prisma.auditLogEntry.findMany({
      where: { tenantInn: filter.tenantInn, actorId: filter.actorId },
      orderBy: { at: 'desc' },
      take: filter.limit ?? 200,
    });
    return rows.map((r) => ({ ...r, meta: r.meta as Record<string, unknown> | null }));
  }
}
