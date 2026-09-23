import type { PrismaClient } from '@prisma/client';
import type { OtpRepo } from '../../domain/ports.js';
import type { OtpCode, OtpPurpose } from '../../domain/types.js';

export class PrismaOtpRepo implements OtpRepo {
  constructor(private prisma: PrismaClient) {}

  async create(accountId: string, purpose: OtpPurpose, codeHash: string, via: 'sms' | 'email', ttlMs: number): Promise<OtpCode> {
    return this.prisma.otpCode.create({
      data: { accountId, purpose, codeHash, via, expiresAt: new Date(Date.now() + ttlMs) },
    });
  }

  async findLatestActive(accountId: string, purpose: OtpPurpose): Promise<OtpCode | null> {
    return this.prisma.otpCode.findFirst({
      where: { accountId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async consume(id: string): Promise<void> {
    await this.prisma.otpCode.update({ where: { id }, data: { consumedAt: new Date() } }).catch(() => undefined);
  }
}
