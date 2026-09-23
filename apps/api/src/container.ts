import type { PrismaClient } from '@prisma/client';
import type { Repos } from './domain/ports.js';
import { SystemClock } from './infra/memory/systemClock.js';
import { ConsoleNotifier } from './infra/memory/notifier.js';
import { PrismaTenantRepo } from './infra/prisma/tenantRepo.js';
import { PrismaAccountRepo } from './infra/prisma/accountRepo.js';
import { PrismaSessionRepo } from './infra/prisma/sessionRepo.js';
import { PrismaOtpRepo } from './infra/prisma/otpRepo.js';
import { PrismaAuditLog } from './infra/prisma/auditLog.js';
import { PrismaSecondHandRepo } from './infra/prisma/secondHandRepo.js';
import { PrismaDocumentGrantRepo } from './infra/prisma/documentGrantRepo.js';
import { PrismaChannelStore } from './infra/prisma/channelStore.js';
import { PrismaExecutorMarkRepo } from './infra/prisma/executorMarkRepo.js';
import { LocalDiskFileStorage } from './infra/files/localDiskFileStorage.js';
import { AuthService } from './auth/service.js';
import { SecondHandService } from './secondHand/service.js';
import { DocumentService } from './documents/service.js';
import { ExecutorService } from './executor/service.js';
import { WalkService } from './walk/service.js';

/**
 * Сборка приложения на реальных (Prisma) адаптерах. Тесты используют
 * `testUtil/memoryRepos.ts` вместо этой сборки — сервисы от источника
 * данных не зависят (порты в domain/ports.ts).
 *
 * SERVER.md §7 "до запуска решить": ConsoleNotifier печатает коды 2FA/сброса
 * в лог сервера — замените на реальный шлюз смс/почты до продакшена
 * (см. .env.example и заготовки в infra/providers, когда провайдер выбран).
 */
export function buildContainer(prisma: PrismaClient) {
  const repos: Repos = {
    clock: new SystemClock(),
    tenants: new PrismaTenantRepo(prisma),
    accounts: new PrismaAccountRepo(prisma),
    sessions: new PrismaSessionRepo(prisma),
    otps: new PrismaOtpRepo(prisma),
    auditLog: new PrismaAuditLog(prisma),
    secondHand: new PrismaSecondHandRepo(prisma),
    documentGrants: new PrismaDocumentGrantRepo(prisma),
    channels: new PrismaChannelStore(prisma),
    executorMarks: new PrismaExecutorMarkRepo(prisma),
    files: new LocalDiskFileStorage(process.env.FILES_DIR || './var/uploads'),
    notifier: new ConsoleNotifier(),
  };
  return buildContainerFromRepos(repos);
}

/**
 * Сборка сервисного слоя поверх ЛЮБОГО набора репозиториев, реализующих порты
 * из domain/ports.ts. Используется и продовой сборкой (Prisma-репозитории выше),
 * и HTTP-интеграционными тестами (`testUtil/memoryRepos.ts`) — сервисы от
 * конкретного хранилища не зависят.
 */
export function buildContainerFromRepos(repos: Repos) {
  return {
    repos,
    auth: new AuthService(repos),
    secondHand: new SecondHandService(repos),
    documents: new DocumentService(repos),
    executor: new ExecutorService(repos),
    walk: new WalkService(repos),
  };
}

export type Container = ReturnType<typeof buildContainerFromRepos>;
