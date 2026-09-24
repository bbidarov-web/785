import type { PrismaClient, Prisma } from '@prisma/client';
import type { AuditLog } from '../../domain/ports.js';
import type { AuditLogEntry } from '../../domain/types.js';
import { computeEntryHash, verifyChain } from '../../audit/chain.js';

function toEntry(r: { id: string; seq: number; at: Date; actorId: string | null; actorRole: string | null; tenantInn: string | null; action: string; target: string | null; meta: unknown; allowed: boolean; prevHash: string | null; hash: string }): AuditLogEntry {
  return { ...r, actorRole: r.actorRole as AuditLogEntry['actorRole'], meta: r.meta as Record<string, unknown> | null };
}

/**
 * Только INSERT — см. `prisma/hardening.sql` для отказа в UPDATE/DELETE на
 * уровне БД. Каждая запись подписана HMAC-цепочкой (audit/chain.ts):
 * `pg_advisory_xact_lock` сериализует добавления, иначе два одновременных
 * INSERT могли бы оба прочитать один и тот же "последний хеш" и построить
 * две расходящиеся ветки вместо одной последовательности.
 */
export class PrismaAuditLog implements AuditLog {
  constructor(private prisma: PrismaClient, private secret: string) {}

  async append(entry: Omit<AuditLogEntry, 'id' | 'at' | 'seq' | 'prevHash' | 'hash'>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('k785_audit_log_chain'))`;
      const last = await tx.auditLogEntry.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true, hash: true } });
      const seq = (last?.seq ?? 0) + 1;
      const prevHash = last?.hash ?? null;
      const at = new Date();
      const hash = computeEntryHash(this.secret, prevHash, { ...entry, seq, at });
      await tx.auditLogEntry.create({
        data: {
          seq,
          at,
          actorId: entry.actorId,
          actorRole: entry.actorRole,
          tenantInn: entry.tenantInn,
          action: entry.action,
          target: entry.target,
          meta: (entry.meta ?? undefined) as Prisma.InputJsonValue | undefined,
          allowed: entry.allowed,
          prevHash,
          hash,
        },
      });
    });
  }

  async list(filter: { tenantInn?: string; actorId?: string; limit?: number }): Promise<AuditLogEntry[]> {
    const rows = await this.prisma.auditLogEntry.findMany({
      where: { tenantInn: filter.tenantInn, actorId: filter.actorId },
      orderBy: { at: 'desc' },
      take: filter.limit ?? 200,
    });
    return rows.map(toEntry);
  }

  async verifyChain(): Promise<{ ok: boolean; brokenAtSeq: number | null }> {
    const rows = await this.prisma.auditLogEntry.findMany({ orderBy: { seq: 'asc' } });
    return verifyChain(this.secret, rows.map(toEntry));
  }
}
