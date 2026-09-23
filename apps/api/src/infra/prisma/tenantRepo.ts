import type { PrismaClient } from '@prisma/client';
import type { TenantRepo } from '../../domain/ports.js';

export class PrismaTenantRepo implements TenantRepo {
  constructor(private prisma: PrismaClient) {}

  // Название клиники фиксируется первой регистрацией под этим ИНН и дальше не
  // перезаписывается сама собой — второй сотрудник той же клиники не должен
  // случайно переименовать арендатора своей регистрацией. Смена названия —
  // отдельное действие (профиль компании), не побочный эффект upsert.
  async upsert(inn: string, name: string): Promise<void> {
    await this.prisma.tenant.upsert({ where: { inn }, create: { inn, name }, update: {} });
  }

  async findByInn(inn: string): Promise<{ inn: string; name: string } | null> {
    const row = await this.prisma.tenant.findUnique({ where: { inn } });
    return row ? { inn: row.inn, name: row.name } : null;
  }

  async listAll(): Promise<{ inn: string; name: string; createdAt: Date }[]> {
    const rows = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({ inn: r.inn, name: r.name, createdAt: r.createdAt }));
  }
}
