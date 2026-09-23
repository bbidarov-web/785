import type { ChannelStore, Clock } from '../../domain/ports.js';
import type { ChannelRecord } from '../../domain/types.js';

interface StoredRow extends ChannelRecord {
  lastOpId: string | null;
}

/**
 * Версионированное key-value хранилище каналов — серверный эквивалент
 * `createClient().get/set` из `reference/prototype/platform.js`, но без
 * доверия клиенту: scope/tenant задаёт вызывающий сервис, а не параметр запроса.
 */
export class InMemoryChannelStore implements ChannelStore {
  private rows = new Map<string, StoredRow>();
  constructor(private clock: Clock) {}

  private keyOf(scope: 'platform' | 'tenant', tenantInn: string | null, key: string): string {
    return scope === 'platform' ? `platform:${key}` : `tenant:${tenantInn}:${key}`;
  }

  async get<T>(scope: 'platform' | 'tenant', tenantInn: string | null, key: string, fallback: T): Promise<ChannelRecord<T>> {
    const row = this.rows.get(this.keyOf(scope, tenantInn, key));
    if (!row) return { data: fallback, version: 0, updatedAt: this.clock.now(), updatedBy: null };
    return row as ChannelRecord<T>;
  }

  async set<T>(
    scope: 'platform' | 'tenant',
    tenantInn: string | null,
    key: string,
    value: T,
    opts: { expectedVersion?: number; updatedBy: string | null; opId?: string | null },
  ): Promise<{ ok: true; version: number; idempotent?: boolean } | { ok: false; conflict: true; version: number }> {
    const k = this.keyOf(scope, tenantInn, key);
    const current = this.rows.get(k);
    const currentVersion = current?.version ?? 0;
    // повтор той же операции (офлайн-очередь пересылает её, пока не получит ответ)
    // не должен применяться второй раз — возвращаем прежний результат как есть
    if (opts.opId && current?.lastOpId === opts.opId) {
      return { ok: true, version: currentVersion, idempotent: true };
    }
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== currentVersion) {
      return { ok: false, conflict: true, version: currentVersion };
    }
    const nextVersion = currentVersion + 1;
    this.rows.set(k, { data: value, version: nextVersion, updatedAt: this.clock.now(), updatedBy: opts.updatedBy, lastOpId: opts.opId ?? null });
    return { ok: true, version: nextVersion };
  }
}
