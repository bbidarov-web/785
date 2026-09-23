import type { TenantRepo } from '../../domain/ports.js';

export class InMemoryTenantRepo implements TenantRepo {
  private rows = new Map<string, string>();

  // см. PrismaTenantRepo — имя фиксируется первой регистрацией, дальше не перезаписывается
  async upsert(inn: string, name: string): Promise<void> {
    if (!this.rows.has(inn)) this.rows.set(inn, name);
  }

  async findByInn(inn: string): Promise<{ inn: string; name: string } | null> {
    const name = this.rows.get(inn);
    return name ? { inn, name } : null;
  }
}
