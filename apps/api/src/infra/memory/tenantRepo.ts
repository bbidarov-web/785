import type { Clock, TenantRepo } from '../../domain/ports.js';

export class InMemoryTenantRepo implements TenantRepo {
  private rows = new Map<string, { name: string; createdAt: Date }>();
  constructor(private clock: Clock) {}

  // см. PrismaTenantRepo — имя фиксируется первой регистрацией, дальше не перезаписывается
  async upsert(inn: string, name: string): Promise<void> {
    if (!this.rows.has(inn)) this.rows.set(inn, { name, createdAt: this.clock.now() });
  }

  async findByInn(inn: string): Promise<{ inn: string; name: string } | null> {
    const row = this.rows.get(inn);
    return row ? { inn, name: row.name } : null;
  }

  async listAll(): Promise<{ inn: string; name: string; createdAt: Date }[]> {
    return Array.from(this.rows.entries())
      .map(([inn, row]) => ({ inn, name: row.name, createdAt: row.createdAt }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}
