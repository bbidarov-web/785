import type { PrismaClient, Prisma } from '@prisma/client';
import type { ChannelStore } from '../../domain/ports.js';
import type { ChannelRecord } from '../../domain/types.js';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Версионированное хранилище каналов на Postgres. Запись — условный UPDATE
 * (`WHERE version = expectedVersion`), а не read-modify-write: это единственный
 * способ гарантировать, что конфликт двух одновременных правок будет обнаружен,
 * а не потерян между чтением версии в приложении и записью (SERVER.md §3).
 */
export class PrismaChannelStore implements ChannelStore {
  constructor(private prisma: PrismaClient) {}

  async get<T>(scope: 'platform' | 'tenant', tenantInn: string | null, key: string, fallback: T): Promise<ChannelRecord<T>> {
    if (scope === 'platform') {
      const row = await this.prisma.platformChannel.findUnique({ where: { key } });
      if (!row) return { data: fallback, version: 0, updatedAt: new Date(), updatedBy: null };
      return { data: row.data as T, version: row.version, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
    }
    if (!tenantInn) throw new Error('tenantInn обязателен для scope=tenant');
    const row = await this.prisma.tenantChannel.findUnique({ where: { tenantInn_key: { tenantInn, key } } });
    if (!row) return { data: fallback, version: 0, updatedAt: new Date(), updatedBy: null };
    return { data: row.data as T, version: row.version, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }

  async set<T>(
    scope: 'platform' | 'tenant',
    tenantInn: string | null,
    key: string,
    value: T,
    opts: { expectedVersion?: number; updatedBy: string | null },
  ): Promise<{ ok: true; version: number } | { ok: false; conflict: true; version: number }> {
    return scope === 'platform'
      ? this.setPlatform(key, value, opts)
      : this.setTenant(tenantInn, key, value, opts);
  }

  private async setPlatform<T>(
    key: string,
    value: T,
    opts: { expectedVersion?: number; updatedBy: string | null },
  ): Promise<{ ok: true; version: number } | { ok: false; conflict: true; version: number }> {
    if (opts.expectedVersion !== undefined) {
      const result = await this.prisma.platformChannel.updateMany({
        where: { key, version: opts.expectedVersion },
        data: { data: value as Prisma.InputJsonValue, version: { increment: 1 }, updatedBy: opts.updatedBy },
      });
      if (result.count === 1) return { ok: true, version: opts.expectedVersion + 1 };
      const current = await this.prisma.platformChannel.findUnique({ where: { key } });
      if (!current) {
        if (opts.expectedVersion !== 0) return { ok: false, conflict: true, version: 0 };
        return this.createPlatform(key, value, opts.updatedBy);
      }
      return { ok: false, conflict: true, version: current.version };
    }
    return this.createPlatform(key, value, opts.updatedBy).catch(async () => {
      const current = await this.prisma.platformChannel.findUnique({ where: { key } });
      return { ok: false as const, conflict: true as const, version: current?.version ?? 0 };
    });
  }

  private async createPlatform<T>(key: string, value: T, updatedBy: string | null) {
    try {
      await this.prisma.platformChannel.create({ data: { key, data: value as Prisma.InputJsonValue, version: 1, updatedBy } });
      return { ok: true as const, version: 1 };
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        const current = await this.prisma.platformChannel.findUnique({ where: { key } });
        return { ok: false as const, conflict: true as const, version: current?.version ?? 0 };
      }
      throw err;
    }
  }

  private async setTenant<T>(
    tenantInn: string | null,
    key: string,
    value: T,
    opts: { expectedVersion?: number; updatedBy: string | null },
  ): Promise<{ ok: true; version: number } | { ok: false; conflict: true; version: number }> {
    if (!tenantInn) throw new Error('tenantInn обязателен для scope=tenant');
    if (opts.expectedVersion !== undefined) {
      const result = await this.prisma.tenantChannel.updateMany({
        where: { tenantInn, key, version: opts.expectedVersion },
        data: { data: value as Prisma.InputJsonValue, version: { increment: 1 }, updatedBy: opts.updatedBy },
      });
      if (result.count === 1) return { ok: true, version: opts.expectedVersion + 1 };
      const current = await this.prisma.tenantChannel.findUnique({ where: { tenantInn_key: { tenantInn, key } } });
      if (!current) {
        if (opts.expectedVersion !== 0) return { ok: false, conflict: true, version: 0 };
        return this.createTenant(tenantInn, key, value, opts.updatedBy);
      }
      return { ok: false, conflict: true, version: current.version };
    }
    return this.createTenant(tenantInn, key, value, opts.updatedBy).catch(async () => {
      const current = await this.prisma.tenantChannel.findUnique({ where: { tenantInn_key: { tenantInn, key } } });
      return { ok: false as const, conflict: true as const, version: current?.version ?? 0 };
    });
  }

  private async createTenant<T>(tenantInn: string, key: string, value: T, updatedBy: string | null) {
    try {
      await this.prisma.tenantChannel.create({ data: { tenantInn, key, data: value as Prisma.InputJsonValue, version: 1, updatedBy } });
      return { ok: true as const, version: 1 };
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        const current = await this.prisma.tenantChannel.findUnique({ where: { tenantInn_key: { tenantInn, key } } });
        return { ok: false as const, conflict: true as const, version: current?.version ?? 0 };
      }
      throw err;
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === UNIQUE_CONSTRAINT_VIOLATION;
}
