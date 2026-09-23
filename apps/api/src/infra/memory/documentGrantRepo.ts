import { randomUUID } from 'node:crypto';
import type { Clock, DocumentGrantRepo } from '../../domain/ports.js';
import type { DocumentGrantRow } from '../../domain/types.js';

export class InMemoryDocumentGrantRepo implements DocumentGrantRepo {
  private rows: DocumentGrantRow[] = [];
  constructor(private clock: Clock) {}

  async appendEvent(row: Omit<DocumentGrantRow, 'id' | 'at'>): Promise<DocumentGrantRow> {
    const full: DocumentGrantRow = { ...row, id: 'dg_' + randomUUID(), at: this.clock.now() };
    this.rows.push(full);
    return full;
  }

  // Порядок вставки — источник истины для "последней" записи: `at` может совпасть
  // у двух событий в пределах одной миллисекунды (в тестах — всегда, часы стоят),
  // поэтому сортировка по одному только `at` не отличает grant от следующего за ним revoke.
  // На проде та же гарантия — через автоинкрементный `seq`, а не только `at` (см. schema.prisma).
  async latestEvent(tenantInn: string, code: string): Promise<DocumentGrantRow | null> {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const row = this.rows[i];
      if (row && row.tenantInn === tenantInn && row.code === code) return row;
    }
    return null;
  }

  async listForTenant(tenantInn: string): Promise<DocumentGrantRow[]> {
    return this.rows.filter((r) => r.tenantInn === tenantInn).slice().reverse();
  }
}
