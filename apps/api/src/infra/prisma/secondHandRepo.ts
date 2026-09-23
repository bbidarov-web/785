import type { PrismaClient, Prisma } from '@prisma/client';
import type { SecondHandRepo } from '../../domain/ports.js';
import type { SecondHandRequest, SecondHandStatus } from '../../domain/types.js';

export class PrismaSecondHandRepo implements SecondHandRepo {
  constructor(private prisma: PrismaClient) {}

  async create(req: Omit<SecondHandRequest, 'id' | 'requestedAt' | 'status' | 'confirmedById' | 'confirmedAt'>): Promise<SecondHandRequest> {
    const row = await this.prisma.secondHandRequest.create({
      data: {
        type: req.type,
        payload: req.payload as Prisma.InputJsonValue,
        tenantInn: req.tenantInn,
        requestedById: req.requestedById,
        expiresAt: req.expiresAt,
      },
    });
    return { ...row, payload: row.payload as Record<string, unknown> };
  }

  async findById(id: string): Promise<SecondHandRequest | null> {
    const row = await this.prisma.secondHandRequest.findUnique({ where: { id } });
    return row ? { ...row, payload: row.payload as Record<string, unknown> } : null;
  }

  async listPending(): Promise<SecondHandRequest[]> {
    const rows = await this.prisma.secondHandRequest.findMany({ where: { status: 'pending' }, orderBy: { requestedAt: 'desc' } });
    return rows.map((row) => ({ ...row, payload: row.payload as Record<string, unknown> }));
  }

  async setStatus(id: string, status: SecondHandStatus, confirmedById: string | null): Promise<SecondHandRequest> {
    const row = await this.prisma.secondHandRequest.update({
      where: { id },
      data: { status, confirmedById, confirmedAt: status === 'confirmed' || status === 'rejected' ? new Date() : null },
    });
    return { ...row, payload: row.payload as Record<string, unknown> };
  }
}
