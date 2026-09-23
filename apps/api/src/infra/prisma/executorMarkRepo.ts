import type { PrismaClient } from '@prisma/client';
import type { ExecutorMarkRepo } from '../../domain/ports.js';

export class PrismaExecutorMarkRepo implements ExecutorMarkRepo {
  constructor(private prisma: PrismaClient) {}

  async markDone(accountId: string, itemKey: string, label: string): Promise<void> {
    await this.prisma.executorMark.upsert({
      where: { accountId_itemKey: { accountId, itemKey } },
      create: { accountId, itemKey, label, doneAt: new Date() },
      update: { doneAt: new Date() },
    });
  }

  async listForAccount(accountId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.executorMark.findMany({ where: { accountId } });
    const out: Record<string, string> = {};
    for (const row of rows) out[row.itemKey] = row.doneAt.toISOString().slice(0, 10);
    return out;
  }
}
