import type { PrismaClient } from '@prisma/client';
import type { DocumentGrantRepo } from '../../domain/ports.js';
import type { DocumentGrantRow } from '../../domain/types.js';

export class PrismaDocumentGrantRepo implements DocumentGrantRepo {
  constructor(private prisma: PrismaClient) {}

  async appendEvent(row: Omit<DocumentGrantRow, 'id' | 'at'>): Promise<DocumentGrantRow> {
    return this.prisma.documentGrant.create({ data: row });
  }

  /** `seq` — автоинкремент, а не `at`: две записи в одной транзакции могут получить одинаковое время. */
  async latestEvent(tenantInn: string, code: string): Promise<DocumentGrantRow | null> {
    return this.prisma.documentGrant.findFirst({ where: { tenantInn, code }, orderBy: { seq: 'desc' } });
  }

  async listForTenant(tenantInn: string): Promise<DocumentGrantRow[]> {
    return this.prisma.documentGrant.findMany({ where: { tenantInn }, orderBy: { seq: 'desc' } });
  }
}
