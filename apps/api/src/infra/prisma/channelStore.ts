import type { PrismaClient, Prisma } from '@prisma/client';
import type { ChannelStore } from '../../domain/ports.js';
import type { ChannelRecord } from '../../domain/types.js';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

type SetOpts = { expectedVersion?: number; updatedBy: string | null; opId?: string | null };
type SetResult = { ok: true; version: number; idempotent?: boolean } | { ok: false; conflict: true; version: number };

/**
 * Версионированное хранилище каналов на Postgres. Запись — условный UPDATE
 * (`WHERE version = expectedVersion`), а не read-modify-write: это единственный
 * способ гарантировать, что конфликт двух одновременных правок будет обнаружен,
 * а не потерян между чтением версии в приложении и записью (SERVER.md §3).
 *
 * `opId` проверяется ДО версии: повтор из офлайн-очереди обхода (SERVER.md §6.5)
 * не должен упасть в конфликт версий только потому, что первая попытка уже прошла —
 * он должен тихо получить прежний результат.
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

  async set<T>(scope: 'platform' | 'tenant', tenantInn: string | null, key: string, value: T, opts: SetOpts): Promise<SetResult> {
    if (opts.opId) {
      const dupe = await this.findByOpId(scope, tenantInn, key, opts.opId);
      if (dupe) return { ok: true, version: dupe.version, idempotent: true };
    }
    return scope === 'platform' ? this.setPlatform(key, value, opts) : this.setTenant(tenantInn, key, value, opts);
  }

  private async findByOpId(scope: 'platform' | 'tenant', tenantInn: string | null, key: string, opId: string): Promise<{ version: number } | null> {
    if (scope === 'platform') {
      const row = await this.prisma.platformChannel.findFirst({ where: { key, lastOpId: opId } });
      return row ? { version: row.version } : null;
    }
    const row = await this.prisma.tenantChannel.findFirst({ where: { tenantInn: tenantInn ?? undefined, key, lastOpId: opId } });
    return row ? { version: row.version } : null;
  }

  private async setPlatform<T>(key: string, value: T, opts: SetOpts): Promise<SetResult> {
    if (opts.expectedVersion !== undefined) {
      const result = await this.prisma.platformChannel.updateMany({
        where: { key, version: opts.expectedVersion },
        data: { data: value as Prisma.InputJsonValue, version: { increment: 1 }, updatedBy: opts.updatedBy, lastOpId: opts.opId ?? null },
      });
      if (result.count === 1) return { ok: true, version: opts.expectedVersion + 1 };
      const current = await this.prisma.platformChannel.findUnique({ where: { key } });
      if (!current) {
        if (opts.expectedVersion !== 0) return { ok: false, conflict: true, version: 0 };
        return this.createPlatform(key, value, opts);
      }
      return { ok: false, conflict: true, version: current.version };
    }
    return this.createPlatform(key, value, opts).catch(async () => {
      const current = await this.prisma.platformChannel.findUnique({ where: { key } });
      return { ok: false as const, conflict: true as const, version: current?.version ?? 0 };
    });
  }

  private async createPlatform<T>(key: string, value: T, opts: SetOpts): Promise<SetResult> {
    try {
      await this.prisma.platformChannel.create({ data: { key, data: value as Prisma.InputJsonValue, version: 1, updatedBy: opts.updatedBy, lastOpId: opts.opId ?? null } });
      return { ok: true, version: 1 };
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        const current = await this.prisma.platformChannel.findUnique({ where: { key } });
        return { ok: false, conflict: true, version: current?.version ?? 0 };
      }
      throw err;
    }
  }

  private async setTenant<T>(tenantInn: string | null, key: string, value: T, opts: SetOpts): Promise<SetResult> {
    if (!tenantInn) throw new Error('tenantInn обязателен для scope=tenant');
    if (opts.expectedVersion !== undefined) {
      const result = await this.prisma.tenantChannel.updateMany({
        where: { tenantInn, key, version: opts.expectedVersion },
        data: { data: value as Prisma.InputJsonValue, version: { increment: 1 }, updatedBy: opts.updatedBy, lastOpId: opts.opId ?? null },
      });
      if (result.count === 1) return { ok: true, version: opts.expectedVersion + 1 };
      const current = await this.prisma.tenantChannel.findUnique({ where: { tenantInn_key: { tenantInn, key } } });
      if (!current) {
        if (opts.expectedVersion !== 0) return { ok: false, conflict: true, version: 0 };
        return this.createTenant(tenantInn, key, value, opts);
      }
      return { ok: false, conflict: true, version: current.version };
    }
    return this.createTenant(tenantInn, key, value, opts).catch(async () => {
      const current = await this.prisma.tenantChannel.findUnique({ where: { tenantInn_key: { tenantInn, key } } });
      return { ok: false as const, conflict: true as const, version: current?.version ?? 0 };
    });
  }

  private async createTenant<T>(tenantInn: string, key: string, value: T, opts: SetOpts): Promise<SetResult> {
    try {
      await this.prisma.tenantChannel.create({ data: { tenantInn, key, data: value as Prisma.InputJsonValue, version: 1, updatedBy: opts.updatedBy, lastOpId: opts.opId ?? null } });
      return { ok: true, version: 1 };
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        const current = await this.prisma.tenantChannel.findUnique({ where: { tenantInn_key: { tenantInn, key } } });
        return { ok: false, conflict: true, version: current?.version ?? 0 };
      }
      throw err;
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === UNIQUE_CONSTRAINT_VIOLATION;
}
