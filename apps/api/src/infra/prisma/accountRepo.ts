import type { PrismaClient } from '@prisma/client';
import type { AccountRepo } from '../../domain/ports.js';
import type { Account } from '../../domain/types.js';

function toDomain(row: NonNullable<Awaited<ReturnType<PrismaClient['account']['findUnique']>>>): Account {
  return {
    id: row.id,
    inn: row.inn,
    login: row.login,
    phone: row.phone,
    email: row.email,
    org: row.org,
    fio: row.fio,
    side: row.side,
    role: row.role,
    pending: row.pending,
    requestedRole: row.requestedRole,
    passwordHash: row.passwordHash,
    twoFactor: row.twoFactor,
    twoFactorVia: row.twoFactorVia,
    blocked: row.blocked,
    mustChange: row.mustChange,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    approvedById: row.approvedById,
    approvedAt: row.approvedAt,
    passwordChangedAt: row.passwordChangedAt,
  };
}

export class PrismaAccountRepo implements AccountRepo {
  constructor(private prisma: PrismaClient) {}

  async create(acc: Omit<Account, 'id' | 'createdAt' | 'lastLoginAt' | 'approvedById' | 'approvedAt' | 'passwordChangedAt'>): Promise<Account> {
    // арендатор создаётся неявно при первой регистрации клиники — upsert, а не отдельная миграция
    if (acc.side === 'clinic') {
      await this.prisma.tenant.upsert({
        where: { inn: acc.inn },
        create: { inn: acc.inn, name: acc.org || `ИНН ${acc.inn}` },
        update: {},
      });
    }
    const row = await this.prisma.account.create({ data: acc });
    return toDomain(row);
  }

  async findById(id: string): Promise<Account | null> {
    const row = await this.prisma.account.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByInnLogin(inn: string, login: string): Promise<Account | null> {
    const row = await this.prisma.account.findUnique({ where: { inn_login: { inn, login: login.toLowerCase() } } });
    return row ? toDomain(row) : null;
  }

  async findByInnPhone(inn: string, phone: string): Promise<Account | null> {
    const row = await this.prisma.account.findFirst({ where: { inn, phone } });
    return row ? toDomain(row) : null;
  }

  async listPending(): Promise<Account[]> {
    const rows = await this.prisma.account.findMany({ where: { pending: true } });
    return rows.map(toDomain);
  }

  async update(id: string, patch: Partial<Account>): Promise<Account> {
    const row = await this.prisma.account.update({ where: { id }, data: patch });
    return toDomain(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.account.delete({ where: { id } });
  }
}
