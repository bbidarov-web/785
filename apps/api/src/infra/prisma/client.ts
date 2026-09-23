import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

/** Единственный экземпляр PrismaClient на процесс (пул соединений переиспользуется). */
export function getPrismaClient(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn', 'query'],
    });
  }
  return client;
}
