import type { ChannelStore, Clock } from '../../domain/ports.js';
import type { ChannelRecord } from '../../domain/types.js';

/**
 * Версионированное key-value хранилище каналов — серверный эквивалент
 * `createClient().get/set` из `reference/prototype/platform.js`, но без
 * доверия клиенту: scope/tenant задаёт вызывающий сервис, а не параметр запроса.
 */
export class InMemoryChannelStore implements ChannelStore {
  private rows = new Map<string, ChannelRecord>();
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
    opts: { expectedVersion?: number; updatedBy: string | null },
  ): Promise<{ ok: true; version: number } | { ok: false; conflict: true; version: number }> {
    const k = this.keyOf(scope, tenantInn, key);
    const current = this.rows.get(k);
    const currentVersion = current?.version ?? 0;
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== currentVersion) {
      return { ok: false, conflict: true, version: currentVersion };
    }
    const nextVersion = currentVersion + 1;
    this.rows.set(k, { data: value, version: nextVersion, updatedAt: this.clock.now(), updatedBy: opts.updatedBy });
    return { ok: true, version: nextVersion };
  }
}
